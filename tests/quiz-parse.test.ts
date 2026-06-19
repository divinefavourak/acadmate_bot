import { describe, expect, it } from 'vitest';
import { parseQuestions, parseAnswers, classifyQuizMessage } from '@/utils/quiz-parse';

// The exact layout coaches post: number on its own line, blank line, prompt,
// then the four options (taken from the feature's reference screenshots).
const QUESTIONS = `31.

Which vitamin is produced when the skin is exposed to sunlight?
A. Vitamin A
B. Vitamin B
C. Vitamin C
D. Vitamin D

32.

What is the capital of Kenya?
A. Mombasa
B. Kisumu
C. Nairobi
D. Nakuru`;

// A student submission, one answer per line.
const ANSWERS = `31. D
32. C
33. B
34. C
35. B
36. B
37. B
38. C
39. C
40. B`;

describe('parseQuestions', () => {
  it('parses numbered MCQ blocks with blank-line layout', () => {
    const qs = parseQuestions(QUESTIONS);
    expect(qs).toHaveLength(2);

    expect(qs[0]).toMatchObject({
      number: 31,
      prompt: 'Which vitamin is produced when the skin is exposed to sunlight?',
      options: { A: 'Vitamin A', B: 'Vitamin B', C: 'Vitamin C', D: 'Vitamin D' },
    });
    expect(qs[1].number).toBe(32);
    expect(qs[1].options.C).toBe('Nairobi');
  });

  it('handles the inline "31. Prompt" layout', () => {
    const qs = parseQuestions('31. What is 2+2?\nA. 3\nB. 4\nC. 5\nD. 6');
    expect(qs).toHaveLength(1);
    expect(qs[0].prompt).toBe('What is 2+2?');
    expect(qs[0].options.B).toBe('4');
  });

  it('ignores blocks without enough options', () => {
    expect(parseQuestions('31.\nSome trailing note with no options')).toHaveLength(0);
  });

  it('does not split a block on a prompt line that starts with a digit', () => {
    const qs = parseQuestions('31.\n2 + 2 equals?\nA. 3\nB. 4\nC. 5\nD. 6');
    expect(qs).toHaveLength(1);
    expect(qs[0]).toMatchObject({ number: 31, prompt: '2 + 2 equals?' });
    expect(qs[0].options.B).toBe('4');
  });

  it('does not treat an answer list as questions', () => {
    expect(parseQuestions(ANSWERS)).toHaveLength(0);
  });
});

describe('parseAnswers', () => {
  it('parses one-answer-per-line submissions', () => {
    const map = parseAnswers(ANSWERS);
    expect(map.size).toBe(10);
    expect(map.get(31)).toBe('D');
    expect(map.get(39)).toBe('C');
  });

  it('parses inline "31.D 32.C" layouts', () => {
    const map = parseAnswers('31.D 32.C 33.B');
    expect(map.get(31)).toBe('D');
    expect(map.get(33)).toBe('B');
  });

  it('does not pick answers out of prose', () => {
    expect(parseAnswers('31. A vitamin is produced by sunlight').size).toBe(0);
  });

  it('does not count MCQ option lines as answers', () => {
    expect(parseAnswers('A. Vitamin A\nB. Vitamin B').size).toBe(0);
  });
});

describe('classifyQuizMessage', () => {
  it('classifies a question batch', () => {
    expect(classifyQuizMessage(QUESTIONS)).toBe('questions');
  });

  it('classifies an answer submission', () => {
    expect(classifyQuizMessage(ANSWERS)).toBe('answers');
  });

  it('classifies ordinary chatter as none', () => {
    expect(classifyQuizMessage('are we meeting at 5pm today?')).toBe('none');
  });

  it('does not treat a stray pair embedded in prose as answers', () => {
    expect(classifyQuizMessage('see point 5. A above')).toBe('none');
  });

  it('grades a single-answer submission', () => {
    // One-question quizzes / incremental replies must still be classified.
    expect(classifyQuizMessage('31. D')).toBe('answers');
  });
});
