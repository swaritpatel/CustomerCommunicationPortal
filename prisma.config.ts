import { existsSync } from "node:fs";

import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

dotenv.config();

if (existsSync(".env.local")) {
  dotenv.config({ path: ".env.local", override: true });
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL,
  },
});