import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import userRoute from "./router/userRoute.js";
import questionRoute from "./router/QuestionRoute.js";

dotenv.config({path: "./config/config.env"});

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: "*"}));

  mongoose.connect(process.env.MONGODB_URI).then(() => {
    console.log("Connected to MongoDB");
  }).catch((err) => {
    console.log(err);
  });

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World");
});

app.use("/api/user", userRoute);
app.use("/api/question", questionRoute);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});