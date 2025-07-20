import express from "express";
import User from "../models/userSchema.js";

const router = express.Router();

router.post("/create", async (req, res) => {
    try {
        const { name, email, gender } = req.body;
        const user = new User({ name, email, gender });
        await user.save();
        res.status(201).json(user);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
});

export default router;

