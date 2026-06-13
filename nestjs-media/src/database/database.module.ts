import { Module, Global } from '@nestjs/common';
import { MongoClient, Db } from 'mongodb';

@Global()
@Module({
  providers: [
    {
      provide: 'MONGO_CLIENT',
      useFactory: async (): Promise<MongoClient> => {
        const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/nexaverse';
        const client = new MongoClient(uri);
        try {
          await client.connect();
          console.log('Successfully connected to MongoDB Atlas');
          return client;
        } catch (err) {
          console.error('Failed to connect to MongoDB Atlas:', err.message);
          return client; // Fallback to avoid crashing the server boot in environments without Atlas
        }
      },
    },
    {
      provide: 'MONGO_DB',
      useFactory: (client: MongoClient): Db => {
        return client.db();
      },
      inject: ['MONGO_CLIENT'],
    },
  ],
  exports: ['MONGO_CLIENT', 'MONGO_DB'],
})
export class DatabaseModule {}
