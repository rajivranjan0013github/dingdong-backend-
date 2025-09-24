import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Please add a name"],
    trim: true,
  },
  email: {
    type: String,
    required: [true, "Please add an email"],
    unique: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      "Please add a valid email",
    ],
  },
  preferredLanguage: String,
  gender: {
    type: String,
    enum: ["Male", "Female"],
  },
  questionBook : [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "QuestionBook",
  }],
  solve : [{
    type: mongoose.Schema.Types.ObjectId,
    ref: "Solve",
  }],
}, { timestamps: true });

const User = mongoose.model("User", UserSchema);

export default User;