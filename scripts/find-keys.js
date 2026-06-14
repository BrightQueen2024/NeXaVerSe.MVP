const fs = require('fs');
const path = require('path');

const dir = 'C:\\Users\\HP\\.gemini\\antigravity-ide\\conversations';
const files = fs.readdirSync(dir);

for (const file of files) {
  if (!file.endsWith('.pb')) continue;
  const filePath = path.join(dir, file);
  const stat = fs.statSync(filePath);
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.alloc(16);
  fs.readSync(fd, buffer, 0, 16, 0);
  fs.closeSync(fd);
  
  console.log(`File: ${file}, Size: ${stat.size} bytes, Header: ${buffer.toString('hex')}`);
}
