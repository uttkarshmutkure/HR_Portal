"""Pydantic schemas for structured Gemini output — unchanged from original."""

from pydantic import BaseModel, Field


class TheoryQuestion(BaseModel):
    type: str       = Field(description="Category: e.g., 'Core Concept', 'Scenario-Based', 'Architecture', 'Behavioral'")
    difficulty: str = Field(description="'Easy', 'Medium', or 'Hard'")
    question: str   = Field(description="The exact question to ask the candidate")
    ideal_answer: str = Field(description="Detailed explanation of the correct answer or key points to listen for")


class CodingQuestion(BaseModel):
    difficulty: str     = Field(description="'Easy', 'Medium', or 'Hard'")
    question: str       = Field(description="The coding problem statement with clear input/output requirements")
    solution_code: str  = Field(description="A clean, well-commented solution in the most relevant language for the role")
    explanation: str    = Field(description="Step-by-step explanation of the approach, time complexity, and space complexity")


class TheoryOnlySet(BaseModel):
    theory_questions: list[TheoryQuestion] = Field(description="Exactly 5 theory/behavioral questions")


class CodingOnlySet(BaseModel):
    coding_questions: list[CodingQuestion] = Field(description="Exactly 5 coding/practical questions")