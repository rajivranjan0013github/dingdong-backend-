import express from "express";
import User from "../models/userSchema.js";
import { verifyToken } from "../middleware/authmiddleware.js";

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

// Update user settings
router.post("/settings", verifyToken, async (req, res) => {
    const userId = req.userId;
    const updates = req.body || {};

    // Whitelist allowed fields from user settings
    const allowedFields = ["name", "email", "preferredLanguage", "gender"];
    const sanitizedUpdates = Object.keys(updates)
        .filter((key) => allowedFields.includes(key))
        .reduce((acc, key) => {
            acc[key] = updates[key];
            return acc;
        }, {});

    if (Object.keys(sanitizedUpdates).length === 0) {
        return res.status(400).json({ message: "No valid fields provided to update" });
    }

    try {
        const updatedUser = await User.findByIdAndUpdate(
            userId,
            { $set: sanitizedUpdates },
            { new: true, runValidators: true }
        );

        if (!updatedUser) {
            return res.status(404).json({ message: "User not found" });
        }

        return res.status(200).json({
            success: true,
            user: {
                id: updatedUser._id,
                name: updatedUser.name,
                email: updatedUser.email,
                preferredLanguage: updatedUser.preferredLanguage,
                gender: updatedUser.gender,
            },
        });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
});

export default router;

