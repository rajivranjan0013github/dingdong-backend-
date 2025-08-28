export const generateExplanationPrompt = (question, options, correctAnswer, userAnswer, originalExplanation) => {
  const optionsText = options.map((opt, idx) => `${String.fromCharCode(65 + idx)}. ${opt}`).join('\n');
  
  const correctOptionLetter = String.fromCharCode(65 + correctAnswer);
  const correctOptionText = options[correctAnswer];
  
  const userOptionLetter = String.fromCharCode(65 + userAnswer);
  const userOptionText = options[userAnswer];

  // Dynamically create the list of other options for explanation
  let otherOptionsInstructions = [];
  options.forEach((opt, idx) => {
    if (idx !== correctAnswer) {
      const optionLetter = String.fromCharCode(65 + idx);
      let label = "";
      if (idx === userAnswer) label += " **(Your Selection)**";
      
      otherOptionsInstructions.push(
        `*   **${optionLetter}. ${opt}:${label}**\n    Provide a brief, factual definition.`
      );
    }
  });

  return `As an expert tutor, your primary goal is to adapt the explanation's length and depth to the question's complexity. Be brief and precise for simple topics. Be more detailed, but still factual, for complex topics. Avoid descriptive language and do not repeat information across sections.

**Question Context:**
${question}

**Options:**
${optionsText}

**Correct Answer:** Option ${correctOptionLetter} (${correctOptionText})
**User's Selected Answer:** Option ${userOptionLetter} (${userOptionText})

**Previous Explanation:** ${originalExplanation}

---
**Your Task:**
Generate a new explanation following this exact structure, ensuring each section provides unique, non-repetitive information.

### ✅ The Correct Answer Explained
**${correctOptionLetter}. ${correctOptionText}**
Write a direct, factual explanation. For a simple topic, one or two sentences are sufficient. For a more complex topic, include the most critical facts needed for a solid understanding.

### 📚 Understanding the Other Options
Provide a concise, factual definition for each of the other options.

${otherOptionsInstructions.join('\n')}

### 💡 Related Facts
Provide 1-2 additional, interesting facts that are related to the overall topic but were **not mentioned above**.

### 🧠 Memory Technique
Provide a simple memory technique or a "rule of thumb" if applicable.

---
**Formatting Requirements:**
Use clear markdown formatting with headers, lists, and emphasis for key terms.
`;
};