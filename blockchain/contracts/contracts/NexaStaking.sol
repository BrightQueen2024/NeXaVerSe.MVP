// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title NexaStaking Smart Contract
 * @dev Manages token locking for NEXA to gain premium yields.
 * Early unstaking incurs a 15% penalty fee transferred to a dead address.
 */
contract NexaStaking {
    IERC20 public nexaToken;
    address public owner;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    struct StakePosition {
        uint256 amount;
        uint256 lockStart;
        uint256 lockEnd;
        uint256 apy; // e.g. 5 = 5%, 18 = 18%
        uint256 lastClaimTime;
        bool active;
    }

    // Mapping: User address => list of staking positions
    mapping(address => StakePosition[]) public userStakes;

    event Staked(address indexed user, uint256 indexed index, uint256 amount, uint256 durationDays, uint256 apy);
    event Unstaked(address indexed user, uint256 indexed index, uint256 principalReturned, uint256 penaltyBurned);
    event RewardClaimed(address indexed user, uint256 indexed index, uint256 rewardAmount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Staking: Only owner can call");
        _;
    }

    constructor(address _nexaToken) {
        require(_nexaToken != address(0), "Staking: Invalid token address");
        nexaToken = IERC20(_nexaToken);
        owner = msg.sender;
    }

    /**
     * @dev Locks NEXA tokens inside the contract.
     * @param amount The quantity of NEXA to lock.
     * @param durationDays The lock period duration (must be 30, 90, 180, or 360 days).
     */
    function stake(uint256 amount, uint256 durationDays) external {
        require(amount > 0, "Staking: Amount must be greater than zero");
        require(
            durationDays == 30 || durationDays == 90 || durationDays == 180 || durationDays == 360,
            "Staking: Invalid lock duration"
        );

        // Deduct tokens from user
        require(nexaToken.transferFrom(msg.sender, address(this), amount), "Staking: Token transfer failed");

        uint256 apy = 5; // 30 days = 5% APY
        if (durationDays == 90) apy = 8;
        else if (durationDays == 180) apy = 12;
        else if (durationDays == 360) apy = 18;

        uint256 lockStart = block.timestamp;
        uint256 lockEnd = block.timestamp + (durationDays * 1 days);

        userStakes[msg.sender].push(StakePosition({
            amount: amount,
            lockStart: lockStart,
            lockEnd: lockEnd,
            apy: apy,
            lastClaimTime: lockStart,
            active: true
        }));

        uint256 index = userStakes[msg.sender].length - 1;
        emit Staked(msg.sender, index, amount, durationDays, apy);
    }

    /**
     * @dev Unstakes principal tokens.
     * If called before the lock maturity date, applies a 15% early withdrawal penalty.
     */
    function unstake(uint256 index) external {
        require(index < userStakes[msg.sender].length, "Staking: Index out of bounds");
        StakePosition storage position = userStakes[msg.sender][index];
        require(position.active, "Staking: Position is already inactive");

        // 1. Claim any outstanding rewards first
        uint256 reward = calculateAccruedReward(msg.sender, index);
        if (reward > 0) {
            position.lastClaimTime = block.timestamp;
            require(nexaToken.transfer(msg.sender, reward), "Staking: Reward payout failed");
            emit RewardClaimed(msg.sender, index, reward);
        }

        position.active = false;
        uint256 principal = position.amount;

        // 2. Enforce early unstaking penalty check
        if (block.timestamp < position.lockEnd) {
            uint256 penalty = (principal * 15) / 100;
            uint256 netPrincipal = principal - penalty;

            // Route penalty to burn address, and principal back to user
            require(nexaToken.transfer(BURN_ADDRESS, penalty), "Staking: Penalty transfer failed");
            require(nexaToken.transfer(msg.sender, netPrincipal), "Staking: Principal transfer failed");

            emit Unstaked(msg.sender, index, netPrincipal, penalty);
        } else {
            // Transfer full principal back to user
            require(nexaToken.transfer(msg.sender, principal), "Staking: Principal transfer failed");
            emit Unstaked(msg.sender, index, principal, 0);
        }
    }

    /**
     * @dev Claims accrued yields for a specific position.
     */
    function claim(uint256 index) external {
        require(index < userStakes[msg.sender].length, "Staking: Index out of bounds");
        StakePosition storage position = userStakes[msg.sender][index];
        require(position.active, "Staking: Position is inactive");

        uint256 reward = calculateAccruedReward(msg.sender, index);
        require(reward > 0, "Staking: No rewards accrued yet");

        position.lastClaimTime = block.timestamp;
        require(nexaToken.transfer(msg.sender, reward), "Staking: Reward transfer failed");

        emit RewardClaimed(msg.sender, index, reward);
    }

    /**
     * @dev Computes accrued rewards dynamically based on time elapsed and APY.
     */
    function calculateAccruedReward(address user, uint256 index) public view returns (uint256) {
        StakePosition memory position = userStakes[user][index];
        if (!position.active) {
            return 0;
        }

        uint256 claimEnd = block.timestamp;
        // Cap calculations to lock maturity date
        if (claimEnd > position.lockEnd) {
            claimEnd = position.lockEnd;
        }

        if (position.lastClaimTime >= claimEnd) {
            return 0;
        }

        uint256 timeElapsed = claimEnd - position.lastClaimTime;
        // Formula: reward = (amount * apy * timeElapsed) / (365 days * 100)
        uint256 reward = (position.amount * position.apy * timeElapsed) / (365 days * 100);
        return reward;
    }

    /**
     * @dev Retrieves total stakes count for a user.
     */
    function getStakesCount(address user) external view returns (uint256) {
        return userStakes[user].length;
    }
}
