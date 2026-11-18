import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Button, Card, IconButton, Note, Screen, SectionTitle, Text, TextField } from "../ui/primitives";
import { allTransactions } from "../db/moneyTracker";
import { budgets } from "../db/moneyTracker";
import { core } from "../rust/core";

const EXAMPLES = [
  "What did I spend?",
  "What is my biggest category?",
  "How much income did I record?",
  "Budget groceries",
  "What is my average per day?",
];

export default function AskScreen() {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [budgetList, setBudgetList] = useState<unknown[]>([]);

  useEffect(() => {
    void Promise.all([allTransactions(), budgets()]).then(([t, b]) => { setRows(t); setBudgetList(b); });
  }, []);

  const ask = (text = question) => {
    if (!text.trim()) return;
    setAnswer(core.assistant(text, rows, budgetList));
  };

  return (
    <Screen
      title="Ask your money"
      subtitle="Answers computed locally from your ledger"
      back={<IconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}
    >
      <Card>
        <SectionTitle>Ask a question</SectionTitle>
        <TextField label="Question" value={question} onChangeText={setQuestion} placeholder="What did I spend?" />
        <Button label="Ask" icon="comment-question" onPress={() => ask()} disabled={!question.trim()} />
      </Card>
      <Card>
        <SectionTitle>Try these</SectionTitle>
        {EXAMPLES.map((example) => (
          <Button key={example} label={example} tone="secondary" onPress={() => { setQuestion(example); ask(example); }} />
        ))}
      </Card>
      {answer ? (
        <Card tone="accent">
          <Text variant="subheading">Answer</Text>
          <Text>{answer}</Text>
        </Card>
      ) : (
        <Note tone="muted">All answers come from Rust queries over your local transactions and budgets. Nothing is sent to a model or server.</Note>
      )}
    </Screen>
  );
}
