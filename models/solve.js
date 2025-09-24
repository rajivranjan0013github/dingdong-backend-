import mongoose from "mongoose";

const SolveSchema = new mongoose.Schema({
  question: String,
  answer: String,
  user:mongoose.Schema.Types.ObjectId,
  
}, { timestamps: true });

const Solve = mongoose.model("Solve", SolveSchema);

export default Solve;