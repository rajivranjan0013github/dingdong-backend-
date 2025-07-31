import express from "express";
import QuestionBook from "../models/questionBookSchema.js";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { verifyToken } from "../middleware/authmiddleware.js";
import mongoose from "mongoose";
import User from "../models/userSchema.js";
dotenv.config({ path: "../config/config.env" });

const router = express.Router();
function extractJsonFromResponse(text) {
  try {
    // Try to parse as-is first
    return JSON.parse(text);
  } catch (e) {
    // Try to find JSON in the text
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e2) {
        console.error("Failed to parse extracted JSON:", e2);
      }
    }
    return null;
  }
}

// get all topics (with pagination)

router.get("/", verifyToken, async (req, res) => {
  const userId = req.userId;
  let { skip = 0, limit = 10 } = req.query;
  skip = parseInt(skip);
  limit = parseInt(limit);

  try {
    const user = await User.findById(userId).select("questionBook");
    const total = user.questionBook.length;

    // Slice only the required IDs
    const questionBookIds = user.questionBook.slice(skip, skip + limit);

    const topics = await QuestionBook.find({
      _id: { $in: questionBookIds },
    })
      .sort({ createdAt: -1 })
      .select("-questions"); // Exclude heavy data

    res.status(200).json({
      topics,
      hasMore: skip + topics.length < total,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// generate questions
router.post("/generate-topic", verifyToken, async (req, res) => {
  const { topic } = req.body;
  const userId = req.userId;
  let session;

  if (!topic) {
    return res.status(400).json({
      message:
        "Prompt, topic, exact instruction, and number of questions are all required for question generation.",
    });
  }

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    const user = await User.findById(userId).session(session);
    const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);

    const schema = {
      type: Type.OBJECT,
      properties: {
        prompt: { type: Type.STRING },
        topic: { type: Type.STRING },
        questions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              answer: { type: Type.NUMBER },
              explanation: { type: Type.STRING },
            },
            required: ["question", "options", "answer", "explanation"],
          },
        },
      },
      required: ["prompt", "topic", "questions"],
    };

    const geminiPrompt = `You are the worlds best question generator.

   The user input is : ${topic}

   Your task:
    1. Understand the topic(s), difficulty level, and exam-style (if any) from the user input — even if casually phrased.
    2. Infer whether the user wants questions related to an exam (like SSC, IBPS, GRE,SAT, JEE, NEET, etc.) or specific subjects (e.g., English, Chemistry, GK).
    3. For the referred exam, generate questions accordingly keep variety in the questions easy medium and hard.
    3. Use that understanding to generate relevant 25 questions accordingly.

    Options format for the questions:
      1. Each question must have exactly 4 options.
      2. Options must be stored in an array where:
        - The **first option** is at **index 0**
        - The second at index 1, and so on.

    Answer format for the questions:
      1. The answer must be a number between 0 and 3 ,and and integer like 0,1,2,3 as you will be follwing 0-based indexing.


Format of the response:
      {
  "prompt": "prompt",
  "topic": "topic",
  "questions": [
    {
      "question": "What is the capital of France?",
      "options": ["London", "Paris", "Rome", "Berlin"],
      "answer": 1,
      "explanation": "Paris is the capital of France."
    },
    {
      "question": "Who wrote 'Hamlet'?",
      "options": ["William Shakespeare", "Mark Twain", "Charles Dickens", "Jane Austen"],
      "answer": 0,
      "explanation": "Hamlet is a famous play written by William Shakespeare."
    }
  ]
}

As you can see the answer is an integer between 0 and 3 following 0-based indexing.
 0-based indexing means that the first option is at index 0, the second at index 1, and so on.


    `;

    const result = await genAI.models.generateContent({
      model: "gemini-2.5-flash-lite-preview-06-17",
      contents: [{ text: geminiPrompt }],
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });
    const generatedText = result.text;
    const parsedData = extractJsonFromResponse(generatedText);

    const newQuestionBook = new QuestionBook({
      prompt: parsedData.prompt,
      topic: parsedData.topic,
      questions: parsedData.questions,
      questionLength: parsedData?.questions?.length,
      user: user._id,
    });

    user.questionBook.push(newQuestionBook._id);
    await user.save({ session });
    await newQuestionBook.save({ session });

    await session.commitTransaction();

    res.status(200).json({
      message: "Questions generated and saved successfully!",
      data: newQuestionBook,
    });
  } catch (error) {
    if (session) {
      await session.abortTransaction();
    }
    console.error("Error generating questions with Gemini API:", error);
    res.status(500).json({ message: error.message });
  } finally {
    if (session) {
      session.endSession();
    }
  }
});

// generate more questions
router.post("/more-questions", async (req, res) => {
  const { questionBookId } = req.body;

  if (!questionBookId) {
    return res.status(400).json({
      message: "questionBookId is required to generate more questions.",
    });
  }

  try {
    const questionBook = await QuestionBook.findById(questionBookId);

    if (!questionBook) {
      return res.status(404).json({ message: "QuestionBook not found." });
    }

    const { topic, questions: existingQuestions } = questionBook;

    const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);

    const schema = {
      type: Type.OBJECT,
      properties: {
        prompt: { type: Type.STRING },
        topic: { type: Type.STRING },
        questions: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              answer: { type: Type.NUMBER },
              explanation: { type: Type.STRING },
            },
            required: ["question", "options", "answer", "explanation"],
          },
        },
      },
      required: ["prompt", "topic", "questions"],
    };

    const existingQuestionsText = existingQuestions
      .map((q) => q.question)
      .join("\n");

    const geminiPrompt = `You are the world's best question generator.

    The current topic is: ${topic}

    Here are the previously generated questions on this topic THAT CANNOT BE REPEATED:
    ${existingQuestionsText}

    Your task:
    1. Generate 25 NEW questions related to the topic: "${topic}".
    2. These new questions should be progressively harder than the existing questions.
    3. DO NOT repeat any of the existing questions.
    4. Maintain the same style and format as the existing questions.

    Options format for the questions:
      1. Each question must have exactly 4 options.
      2. Options must be stored in an array where:
        - The **first option** is at **index 0**
        - The second at index 1, and so on.

    Answer format for the questions:
      1. The answer must be a number between 0 and 3 ,and and integer like 0,1,2,3 as you will be follwing 0-based indexing.


Format of the response:
      {
  "prompt": "prompt",
  "topic": "topic",
  "questions": [
    {
      "question": "What is the capital of France?",
      "options": ["London", "Paris", "Rome", "Berlin"],
      "answer": 1,
      "explanation": "Paris is the capital of France."
    },
    {
      "question": "Who wrote 'Hamlet'?",
      "options": ["William Shakespeare", "Mark Twain", "Charles Dickens", "Jane Austen"],
      "answer": 0,
      "explanation": "Hamlet is a famous play written by William Shakespeare."
    }
  ]
}

As you can see the answer is an integer between 0 and 3 following 0-based indexing.
 0-based indexing means that the first option is at index 0, the second at index 1, and so on.
    `;

    const result = await genAI.models.generateContent({
      model: "gemini-2.5-flash-lite-preview-06-17",
      contents: [{ text: geminiPrompt }],
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });
    const generatedText = result.text;

    const parsedData = JSON.parse(generatedText);

    // Append new questions to the existing question book
    questionBook.questions = [
      ...questionBook.questions,
      ...parsedData.questions,
    ];
    await questionBook.save();

    res.status(200).json({
      message: "More questions generated and saved successfully!",
      data: questionBook,
    });
  } catch (error) {
    console.error("Error generating more questions with Gemini API:", error);
    res.status(500).json({ message: error.message });
  }
});

export default router;
