import express from "express";
import QuestionBook from "../models/questionBookSchema.js";
import User from "../models/userSchema.js";
import { GoogleGenAI } from "@google/genai";
const router = express.Router();

router.post("/", async (req, res) => {
  const { questions, user, questionBookId } = req.body;
  try {
    let questionBook;

    if (questionBookId) {
      questionBook = await QuestionBook.findByIdAndUpdate(
        questionBookId,
        { questions },
        { new: true, runValidators: true }
      );

      if (!questionBook) {
        return res.status(404).json({ message: "Question book not found" });
      }

      res.status(200).json(questionBook);
    } else {
      questionBook = new QuestionBook({ questions, user });
      await questionBook.save();
      res.status(201).json(questionBook);
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

router.post("/generate-questions", async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res
      .status(400)
      .json({ message: "Text is required for question generation." });
  }

  try {
    const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);

    const prompt = `Generate a list of 3-5 questions based on the following text. Each question should be an object with 'question' and 'type' properties. The 'type' should always be 'text'.\n\nText: ${text}\n\nExample format: [{ question: "Question 1?", type: "text" }, { question: "Question 2?", type: "text" }]`;

    const result = await genAI.models.generateContent({
        model:"gemini-2.5-flash-lite-preview-06-17",
        content:prompt
    });
    const response = await result.response;
    const generatedText = response.text();

    // Attempt to parse the generated text as JSON
    let generatedQuestions;
    try {
      generatedQuestions = JSON.parse(generatedText);
    } catch (parseError) {
      console.error("Failed to parse AI response as JSON:", parseError);
      console.error("AI Response:", generatedText);
      return res
        .status(500)
        .json({ message: "Failed to parse AI generated questions." });
    }

    if (!Array.isArray(generatedQuestions)) {
      return res
        .status(500)
        .json({
          message: "AI did not return questions in the expected array format.",
        });
    }

    res.status(200).json({ questions: generatedQuestions });
  } catch (error) {
    console.error("Error generating questions with Gemini API:", error);
    res.status(500).json({ message: error.message });
  }
});

router.get("/:id", async (req, res) => {
  console.log("running");

  const { id } = req.params;
  try {
    const questionBook = await QuestionBook.findById(id);
    res.status(200).json(questionBook);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
