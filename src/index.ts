import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";

dotenv.config();

const app = express();

app.use(helmet());

app.use(cors());

app.get("/", (_req, res) => {
  res.send("Hello, World!");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
