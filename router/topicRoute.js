import express from "express";
import QuestionBook from "../models/questionBookSchema.js";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
dotenv.config({ path: "../config/config.env" });


const router = express.Router();

// get all topics
router.get("/", async (req, res) => {
  try {
    const topics = await QuestionBook.find().sort({ createdAt: -1 });
    res.status(200).json(topics);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// generate questions
router.post("/generate-topic", async (req, res) => {
  const { topic } = req.body;
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

  if (!topic) {
    return res.status(400).json({
      message:
        "Prompt, topic, exact instruction, and number of questions are all required for question generation.",
    });
  }

  try {
    const geminiPrompt = `You are the worlds best question generator.

   The user input is : ${topic}

   Your task:
    1. Understand the topic(s), difficulty level, and exam-style (if any) from the user input — even if casually phrased.
    2. Infer whether the user wants questions related to an exam (like SSC, IBPS, GRE,SAT, JEE, NEET, etc.) or specific subjects (e.g., English, Chemistry, GK).
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

    const parsedData = JSON.parse(generatedText);

    const newQuestionBook = new QuestionBook({
      prompt: parsedData.prompt,
      topic: parsedData.topic,
      questions: parsedData.questions,
    });

    await newQuestionBook.save();

    res.status(200).json({
      message: "Questions generated and saved successfully!",
      data: newQuestionBook,
    });
  } catch (error) {
    console.error("Error generating questions with Gemini API:", error);
    res.status(500).json({ message: error.message });
  }
});

export default router;
