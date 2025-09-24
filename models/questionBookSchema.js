import mongoose from "mongoose";

const QuestionBookSchema = new mongoose.Schema({
  user : {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  topic : {
    type: String,
  },
  source:String, //pdf , image , prompt
  prompt : String,
  language:{
    type: String,
    default:"English",
  },
  questions : [{
    question : String,
    options : [String],
    answer : Number,
    explanation : String,
    userAnswer : Number,
    },
  ],
  questionLength: {
    type: Number,
    default: 0,
  },
  answeredLength: {
    type: Number,
    default: 0,
  },
  correctLength: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ["pending", "completed"],
    default: "pending",
  },
}, { timestamps: true });

const QuestionBook = mongoose.model("QuestionBook", QuestionBookSchema);

export default QuestionBook;