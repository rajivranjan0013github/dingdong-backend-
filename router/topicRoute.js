import express from 'express';
import QuestionBook from '../models/questionBookSchema.js';
import { GoogleGenerativeAI } from '@google/generative-ai'


const genAI = new GoogleGenerativeAI("");
// console.log('gemini api key', process.env.GEMINI_API_KEY);

const router = express.Router();

// get all topics
router.get('/', async (req, res) => {
    try {
        const topics = await QuestionBook.find().sort({ createdAt: -1 });
        res.status(200).json(topics);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

// generate topic
router.post('/generate-topic', async (req, res) => {
    // console.log('generate topic', process.env.GEMINI_API_KEY);
    try {
        const { topic, numQuestions = 25 } = req.body;
        const prompt = `
            You are a specialized JSON generation machine. Your single task is to generate a raw JSON array of exactly ${numQuestions} high-quality, multiple-choice question objects on the topic: '${topic}'.

            Follow these rules STRICTLY:
            1.  Your entire response MUST be a single, valid JSON array.
            2.  The response MUST start with the character '[' and end with the character ']'.
            3.  Do NOT output ANY text, explanations, or markdown before or after the JSON array. Your response must be ONLY the array.
            4.  Each object in the array must contain ONLY these four keys: "question", "options", "answer", "explanation".
            5.  The "options" key must be an array of exactly 4 strings.
            6.  The "answer" key must be a number (0, 1, 2, or 3) representing the index of the correct option.

            Generate the JSON array for ${numQuestions} questions on '${topic}' now.`;

        const model = genAI.getGenerativeModel({ 
            model: "gemini-1.5-flash-latest" ,
            generationConfig: {
                response_mime_type: "application/json",
            }
        });
        const result = await model.generateContent(prompt);
        const response = result.response;
        const jsonString = response.text();
        const finalJsonArray = JSON.parse(jsonString);
        const questionBook = await QuestionBook.create({ topic, questions: finalJsonArray });
        res.status(200).json(questionBook);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

export default router;