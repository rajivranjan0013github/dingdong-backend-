import express from "express";
import Solve from "../models/solve.js";
import { verifyToken } from "../middleware/authmiddleware.js";

const router = express.Router();

// GET user's doubts with pagination
router.get("/", verifyToken, async (req, res) => {
  const userId = req.userId;
  const skip = parseInt(req.query.skip) || 0;
  const limit = parseInt(req.query.limit) || 20;

  try {
    const doubts = await Solve.find({ user: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalDoubts = await Solve.countDocuments({ user: userId });
    const hasMore = skip + limit < totalDoubts;

    res.status(200).json({
      doubts,
      hasMore,
      total: totalDoubts,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

export default router;
