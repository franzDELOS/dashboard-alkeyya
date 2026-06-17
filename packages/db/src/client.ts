import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. The database client cannot be created."
  );
}

// One adapter + one client per process. The pg adapter manages its own pool.
const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });
