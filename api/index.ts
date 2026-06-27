import express from "express";
import { registerRoutes } from "../server/routes";

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));

// CORS for Vercel
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

let initialized = false;

export default async function handler(req: any, res: any) {
  if (!initialized) {
    await registerRoutes(app);
    initialized = true;
  }
  app(req, res);
}
