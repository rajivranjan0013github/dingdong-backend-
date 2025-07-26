import { Router } from "express";
import { OAuth2Client } from "google-auth-library";
import User from "../models/userSchema.js";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";

dotenv.config({ path: "./config/config.env" });

const router = Router();
const client = new OAuth2Client(
  "545625865420-95ut16at09ds28eb7o0bum7dgmdug8uf.apps.googleusercontent.com"
);

// Secret key for JWT (consider moving to environment variables)
const JWT_SECRET = process.env.JWT_SECRET;

// Google authentication route
router.post("/google/loginSignUp", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: "Token is required" });
    }

    // Verify the token
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience:
        "545625865420-95ut16at09ds28eb7o0bum7dgmdug8uf.apps.googleusercontent.com",
    });

    const payload = ticket.getPayload();

    // Check if user exists
    let user = await User.findOne({ email: payload.email });

    if (!user) {
      // Create new user if doesn't exist
      user = await User.create({
        email: payload.email,
        name: payload.name,
      });
    }
    console.log(JWT_SECRET);

    // Generate JWT token
    console.log(JWT_SECRET);
    const authToken = jwt.sign({ id: user._id }, JWT_SECRET);

    res.json({
      success: true,
      jwt: authToken,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
      },
    });
  } catch (error) {
    console.error("Error verifying Google token:", error);
    res.status(401).json({
      success: false,
      error: "Invalid token",
    });
  }
});

export default router;
