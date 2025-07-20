import express from "express";
import QuestionBook from "../models/questionBookSchema.js";
import User from "../models/userSchema.js";
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

router.get("/:id", async (req, res) => {
    console.log('running');
    
    const { id } = req.params;
    try {
        const questionBook = await QuestionBook.findById(id);
        res.status(200).json(questionBook);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

export default router;