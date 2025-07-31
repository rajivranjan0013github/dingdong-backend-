import express from "express";
import QuestionBook from "../models/questionBookSchema.js";
import { verifyToken } from "../middleware/authmiddleware.js";
import User from "../models/userSchema.js";
const router = express.Router();

router.post("/", verifyToken, async (req, res) => {
  const userId = req.userId;
  const { questions =[], questionBookId, status='pending', deepLink=false} = req.body;
  const questionLength = questions.length;
  const answeredLength = questions.filter(q => q.userAnswer !== undefined).length;
  const correctLength = questions.filter(q => q.userAnswer === q.answer).length;
  
  try {
    let questionBook;

    if (questionBookId && !deepLink) {
      questionBook = await QuestionBook.findByIdAndUpdate(
        questionBookId,
        { questions, status, questionLength, answeredLength, correctLength },
        { new: true, runValidators: true }
      );

      if (!questionBook) {
        return res.status(404).json({ message: "Question book not found" });
      }

      res.status(200).json(questionBook);
    } else {
      const previousQuestionBook = await QuestionBook.findById(questionBookId).select('-questions');

      questionBook = new QuestionBook({ questions, user : userId, questionLength, answeredLength, correctLength, topic : previousQuestionBook.topic, prompt : previousQuestionBook.prompt});
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      user.questionBook.push(questionBook._id);
      await user.save();
      await questionBook.save();
      res.status(201).json(questionBook);
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});



router.get("/:id", async (req, res) => {

  const { id } = req.params;
  try {
    const questionBook = await QuestionBook.findById(id);
    res.status(200).json(questionBook);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
