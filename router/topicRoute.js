import express from "express";
import QuestionBook from "../models/questionBookSchema.js";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";
import { verifyToken } from "../middleware/authmiddleware.js";
import mongoose from "mongoose";
import User from "../models/userSchema.js";
import Solve from "../models/solve.js";
import Busboy from "busboy";
import { generateExplanationPrompt } from "../utils/promptTemplates.js";
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

// Ensure LaTeX-style backslashes are doubled inside math delimiters.
// Handles $...$, $$...$$, \(...\), and \[...\]. Idempotent on already-doubled sequences.
function ensureDoubleBackslashesInMath(text) {
  if (typeof text !== 'string') return text;

  // Fix single "\" → "\\", then collapse any 4+ "\" to exactly 2
  function fix(inner) {
    let out = inner.replace(/(?<!\\)\\(?!\\)/g, '\\\\');  // single → double
    out = out.replace(/\\\\{2,}/g, '\\\\');               // 4+ → 2
    return out;
  }

  // $...$  or  $$...$$  → always return $...$ (single dollar)
  text = text.replace(/(\${1,2})([\s\S]*?)(\1)/g,
    (_, open, inner) => '$' + fix(inner) + '$'
  );

  // \(...\)
  text = text.replace(/\\\(([\s\S]*?)\\\)/g,
    (_, inner) => '\\(' + fix(inner) + '\\)'
  );

  // \[...\]
  text = text.replace(/\\\[([\s\S]*?)\\\]/g,
    (_, inner) => '\\[' + fix(inner) + '\\]'
  );

  return text;
}


router.post(
  "/upload-pdf",
  verifyToken,
  (req, res, next) => {
    const busboy = Busboy({ headers: req.headers });
    let pdfBuffer = null;
    

    busboy.on("file", (name, file, info) => {
     
      if (info?.mimeType === "application/pdf") {
        const chunks = [];
        file.on("data", (chunk) => chunks.push(chunk));
        file.on("end", () => {
          pdfBuffer = Buffer.concat(chunks);
        });
      }
    });

    busboy.on("field", (fieldname, val) => {
      req.body[fieldname] = val;
    });

    busboy.on("finish", () => {
      if (!pdfBuffer) {
        return res.status(400).json({ message: "No PDF file uploaded." });
      }
      req.file = {
        buffer: pdfBuffer,
        mimetype: "application/pdf",
        originalname: "uploaded.pdf",
      };
      next();
    });

    req.pipe(busboy);
  },
  async (req, res) => {
    const userId = req.userId;
    let session;
   
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ message: "No PDF file uploaded." });
    }
    const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);
    try {
      // 1️⃣ Upload file to Google Files API
      const fileBlob = new Blob([req.file.buffer], { type: 'application/pdf' });

      const fileResp = await genAI.files.upload({
        file: fileBlob,
        config: {
          displayName: req.file.originalname,

        },
      });

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
    


    Your TASK is:

    1. You are given a pdf file. This Pdf constains questions and its respective options and answers and the explanation for the answer.
    2. Some times explanation is not present in the pdf file so you need to generate the explanation for the answer.
    3. You need to extract the questions and its respective options and answers and the explanation for the answer from the pdf file.
    4. The file may contains useless information like table of contents, index, etc so be careful and extract only the questions and its respective options and answers and the explanation for the answer.
    5. The questions should be in the same language as the pdf file.
    6. Do not miss any QUESTIONS given in the pdf file.
    7  The questions should be in HTML format and the latex formatting for the mathematical equations should be used.
  

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
        contents: [
          {
            role: "user",
            parts: [
              { text: geminiPrompt },
              { fileData: { fileUri: fileResp.uri, mimeType: fileResp.mimeType } },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      });
      // Pre-process raw JSON text from model to preserve LaTeX backslashes inside math
      const rawText = ensureDoubleBackslashesInMath(result.text);
      const parsedData = extractJsonFromResponse(rawText);

      if (!parsedData?.questions?.length) {
        return res.status(500).json({ message: "Failed to generate questions from PDF." });
      }

      session = await mongoose.startSession();
      session.startTransaction();

      const user = await User.findById(userId).session(session);

      const newQuestionBook = new QuestionBook({
        prompt: parsedData.prompt,
        topic: parsedData.topic || "Questions from PDF",
        questions: parsedData.questions,
        questionLength: parsedData.questions.length,
        user: user._id,
      });

      user.questionBook.push(newQuestionBook._id);
      await user.save({ session });
      await newQuestionBook.save({ session });
      await session.commitTransaction();

      res.status(200).json({
        message: "Questions generated from PDF and saved successfully!",
        data: newQuestionBook,
      });
    } catch (error) {
      if (session) await session.abortTransaction();
      console.error("Error processing PDF:", error);
      res.status(500).json({ message: error.message });
    } finally {
      if (session) session.endSession();
    }
  }
);


// Upload an image (photo of a question/doubt) and generate questions/solutions
router.post(
  "/upload-image",
  verifyToken,
  (req, res, next) => {
    const busboy = Busboy({ headers: req.headers });
    let imageBuffer = null;
    let imageMimeType = null;
    let originalname = "uploaded-image";
    busboy.on("file", (name, file, info) => {
      const { filename, mimeType } = info || {};
      if (mimeType && mimeType.startsWith("image/")) {
        imageMimeType = mimeType;
        if (filename) originalname = filename;
        const chunks = [];
        file.on("data", chunk => chunks.push(chunk));
        file.on("end", () => {
          imageBuffer = Buffer.concat(chunks);
        });
      } else {
        // Unsupported file type; drain the stream
        file.resume();
      }
    });

    busboy.on("field", (fieldname, val) => {
      req.body[fieldname] = val;
    });

    busboy.on("finish", () => {
      if (!imageBuffer) {
        return res.status(400).json({ message: "No image file uploaded." });
      }
      req.file = {
        buffer: imageBuffer,
        mimetype: imageMimeType || "image/jpeg",
        originalname,
      };
      next();
    });

    req.pipe(busboy);
  },
  async (req, res) => {
    const userId = req.userId;
    let session;
    try {
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ message: "No image file uploaded." });
      }

      const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);

      // 1️⃣ Upload image to Google Files API
      const fileBlob = new Blob([req.file.buffer], { type: req.file.mimetype });
      const fileResp = await genAI.files.upload({
        file: fileBlob,
        config: { displayName: req.file.originalname },
      });

      // 2️⃣ Ask Gemini to extract/solve the doubt and output MCQ-compatible structure
      const schema = {
        type: Type.OBJECT,
        properties: {
          question: { type: Type.STRING },
          answer: { type: Type.STRING }
        },
        required: ["question", "answer"],
      };
      
      const geminiPrompt = `You are the world's best tutor for solving doubts from images.

Task:
1. You are given an image that may contain a question/problem (math, reasoning, science, etc.).
2. Extract the main question clearly from the image.
3. Solve it and provide the final answer directly.
4. If equations are involved, use MathJax formatting correctly You make mistakes in the MathJax formatting so be careful.
5. The format of the answer should be in Markdown format.
5. The output must follow this JSON shape:

{
  "question": "...",
  "answer": "..."
}`;
      
   

      const result = await genAI.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              { text: geminiPrompt },
              { fileData: { fileUri: fileResp.uri, mimeType: fileResp.mimeType } },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      });

      // Pre-process raw JSON text from model to preserve LaTeX backslashes inside math
      
      const rawText = ensureDoubleBackslashesInMath(result.text);
  
      const parsed = extractJsonFromResponse(rawText);
      if (!parsed?.question || !parsed?.answer) {
        return res.status(500).json({ message: "Failed to extract a solved Q&A from image." });
      }

      // 3️⃣ Persist as a Solve (single Q&A), not a QuestionBook
      session = await mongoose.startSession();
      session.startTransaction();

      // Normalize backslashes so LaTeX reaches the client with \\ consistently
     

      const savedSolve = await Solve.create([
        { question: parsed.question, answer: parsed.answer, user: userId},
      ], { session });

      await session.commitTransaction();

      res.status(200).json({
        message: "Solved Q&A generated from image and saved successfully!",
        data: savedSolve?.[0],
      });
    } catch (error) {
      if (session) await session.abortTransaction();
      console.error("Error processing image:", error);
      res.status(500).json({ message: error.message });
    } finally {
      if (session) session.endSession();
    }
  }
);


// Generate a new QuestionBook with MCQs related to a solved question
router.post("/generate-from-solve", verifyToken, async (req, res) => {
  const userId = req.userId;
  const { solveId, question, answer, preferredLanguage } = req.body || {};

  let baseQuestion = question;
  let baseAnswer = answer;

  try {
    // Optionally fetch the Solve if solveId provided
    if ((!baseQuestion || !baseAnswer) && solveId) {
      const solveDoc = await Solve.findById(solveId);
      if (solveDoc) {
        baseQuestion = baseQuestion || solveDoc.question;
        baseAnswer = baseAnswer || solveDoc.answer;
      }
    }

    if (!baseQuestion || !baseAnswer) {
      return res.status(400).json({ message: "Missing base question or answer" });
    }

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

    const pl = preferredLanguage || "English";
    const geminiPrompt = `You are the world's best question setter.

Base solved question is given below. Create a new practice set of 25 high-quality MCQs that are conceptually similar and cover the same underlying ideas, with a healthy mix of  medium, and hard questions.

Rules:
1) The language of all output must be ${pl}.
2) Use proper LaTeX formatting for any mathematical expressions in questions, options, and explanations.
3) Each question must have exactly 4 options.
4) Answers must use 0-based indexing (0..3) referring to options.
5) Provide clear, concise explanations. Prefer math where appropriate.
6) Avoid copying the base question verbatim; vary numbers and context.

Base:
QUESTION:
${baseQuestion}



Respond strictly in this JSON format:
{
  "prompt": "Short instruction users saw",
  "topic": "Short topic name for this practice set",
  "questions": [
    {
      "question": "...",
      "options": ["...","...","...","..."],
      "answer": 0,
      "explanation": "..."
    }
  ]
}`;

    const result = await genAI.models.generateContent({
      model: "gemini-2.5-flash-lite-preview-06-17",
      contents: [{ text: geminiPrompt }],
      config: {
        responseMimeType: "application/json",
        responseSchema: schema,
      },
    });

    const rawText = ensureDoubleBackslashesInMath(result.text);
    const parsedData = extractJsonFromResponse(rawText);

    if (!parsedData?.questions?.length) {
      return res.status(500).json({ message: "Failed to generate related questions" });
    }

    const session = await mongoose.startSession();
    try {
      session.startTransaction();

      const user = await User.findById(userId).session(session);
      const newQuestionBook = new QuestionBook({
        prompt: parsedData.prompt || "Practice similar problems",
        topic: parsedData.topic || "Similar Practice Set",
        questions: parsedData.questions,
        questionLength: parsedData.questions.length,
        user: user._id,
        language: pl,
        source: "image", // derived from a solved image doubt
      });

      user.questionBook.push(newQuestionBook._id);
      await user.save({ session });
      await newQuestionBook.save({ session });
      await session.commitTransaction();

      return res.status(200).json({
        message: "Related questions generated successfully",
        data: newQuestionBook,
      });
    } catch (e) {
      await session.abortTransaction();
      console.error(e);
      return res.status(500).json({ message: e.message });
    } finally {
      session.endSession();
    }
  } catch (error) {
    console.error("Error generating from solve:", error);
    return res.status(500).json({ message: error.message });
  }
});

router.get("/", verifyToken, async (req, res) => {
  const userId = req.userId;
  let { skip = 0, limit = 10 } = req.query;
  skip = parseInt(skip);
  limit = parseInt(limit);

  try {
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Get total count for pagination
    const total = await QuestionBook.countDocuments({ _id: { $in: user.questionBook } });

    // Use proper MongoDB pagination
    const topics = await QuestionBook.find({ _id: { $in: user.questionBook } })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("-questions"); // Exclude heavy data

    res.status(200).json({
      topics,
      hasMore: skip + topics.length < total,
      total
    });
  } catch (err) {
    console.error('Error fetching topics:', err);
    // Handle specific error cases
    if (err.name === 'CastError') {
      return res.status(400).json({ 
        message: 'Invalid ID format',
        error: 'INVALID_ID'
      });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ 
        message: 'Validation failed',
        error: 'VALIDATION_ERROR',
        details: err.errors
      });
    }
    res.status(500).json({ 
      message: 'Internal server error while fetching topics',
      error: 'INTERNAL_ERROR'
    });
  }
});

// generate questions
router.post("/generate-topic", verifyToken, async (req, res) => {
  const { topic ,preferredLanguage} = req.body;
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
The user preferred language is : ${preferredLanguage||"English"}

The questions , options , and explanations should be in the same language as the preferred language of the user.

   Your task:
    1. Understand the topic(s), difficulty level, and exam-style (if any) from the user input — even if casually phrased.
    2. Infer whether the user wants questions related to an exam (like SSC, IBPS, GRE,SAT, JEE, NEET, etc.) or specific subjects (e.g., English, Chemistry, GK).
    3. For the referred exam, generate questions accordingly keep variety in the questions easy medium and hard.
    3. Use that understanding to generate relevant 25 questions accordingly.
    4  Use LaTeX  formatting for the  mathematical equations wherever present in the questions and options or explanations.

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
      language: preferredLanguage||"English",
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

    const { topic, questions: existingQuestions ,language} = questionBook;

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

The user preferred language is : ${language||"English"}

The questions , options , and explanations should be in the same language as the preferred language of the user.

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

// Get AI explanation for a question
router.post("/explain-question", async (req, res) => {
  const { question, options, correctAnswer, userAnswer, originalExplanation,preferredLanguage } = req.body;

  try {
    const genAI = new GoogleGenAI(process.env.GEMINI_API_KEY);

    const prompt = generateExplanationPrompt(
      question,
      options,
      correctAnswer,
      userAnswer,
      originalExplanation,
      preferredLanguage
    );

    const result = await genAI.models.generateContent({
      model: "gemini-2.5-flash-lite-preview-06-17",
      contents: [{ text: prompt }],
    });

    res.status(200).json({
      explanation: result.text,
    });
  } catch (error) {
    console.error("Error generating explanation:", error);
    res.status(500).json({ message: error.message });
  }
});

export default router;