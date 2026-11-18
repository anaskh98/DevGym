// Coach questions: picked by code, worded by the AI, answered in the developer's own words.

export interface QuestionView {
  question_id: string;
  kind: "why" | "explain_back" | "drill";
  item_id: string;
  ticket: string;
  /** What to ask about: the decision summary, or the signal meaning with file and function. Never code. */
  about: string;
  opened: boolean;
}
