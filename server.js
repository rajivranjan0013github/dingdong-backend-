import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import userRoute from "./router/userRoute.js";
import questionRoute from "./router/QuestionRoute.js";
import topicRoute from "./router/topicRoute.js";
import loginRoute from "./router/loginRoute.js";
import doubtsRoute from "./router/doubtsRoute.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: "./config/config.env" });

const app = express();
const PORT = process.env.PORT || 3003;

app.use(cors({ origin: "*"}));

mongoose.connect(process.env.MONGODB_URI).then(() => {
}).catch((err) => {
});

app.use(express.json());



app.use("/api/user", userRoute);
app.use("/api/question", questionRoute);
app.use("/api/topic", topicRoute);
app.use("/api/login", loginRoute);
app.use("/api/doubts", doubtsRoute);

app.use(express.static(path.join(__dirname, "../topicwise-web/dist")));

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, "../topicwise-web/dist/index.html"));
});


app.listen(PORT, () => {});