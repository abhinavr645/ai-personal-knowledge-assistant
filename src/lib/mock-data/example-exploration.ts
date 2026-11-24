import type { Exploration } from "@/types/exploration";

export const exampleExploration: Exploration = {
  query: "How does machine learning work?",
  rootNodeId: "machine-learning",
  nodes: [
    {
      id: "machine-learning",
      name: "Machine Learning",
      category: "Field",
      description:
        "A branch of artificial intelligence that learns patterns from data to make predictions or decisions.",
    },
    {
      id: "artificial-intelligence",
      name: "Artificial Intelligence",
      category: "Field",
      description:
        "The field of building systems that perform tasks such as reasoning, planning, and recognizing patterns.",
    },
    {
      id: "neural-networks",
      name: "Neural Networks",
      category: "Method",
      description:
        "Models that use layers of connected units to learn transformations from inputs to outputs.",
    },
    {
      id: "deep-learning",
      name: "Deep Learning",
      category: "Method",
      description:
        "An approach that uses many neural network layers to learn increasingly complex representations of data.",
    },
    {
      id: "supervised-learning",
      name: "Supervised Learning",
      category: "Learning approach",
      description:
        "Models learn from examples paired with known answers, such as images labeled by what they contain.",
    },
    {
      id: "unsupervised-learning",
      name: "Unsupervised Learning",
      category: "Learning approach",
      description:
        "Models look for structure in data without predefined labels, such as grouping similar examples.",
    },
    {
      id: "reinforcement-learning",
      name: "Reinforcement Learning",
      category: "Learning approach",
      description:
        "An agent learns which actions to take by interacting with an environment and receiving rewards.",
    },
  ],
  edges: [
    {
      id: "ml-ai",
      source: "machine-learning",
      target: "artificial-intelligence",
      kind: "hierarchy",
      label: "is a branch of",
    },
    {
      id: "ml-nn",
      source: "machine-learning",
      target: "neural-networks",
      kind: "connection",
      label: "uses",
    },
    {
      id: "dl-nn",
      source: "deep-learning",
      target: "neural-networks",
      kind: "connection",
      label: "builds on",
    },
    {
      id: "ml-sl",
      source: "machine-learning",
      target: "supervised-learning",
      kind: "hierarchy",
      label: "includes",
    },
    {
      id: "ml-ul",
      source: "machine-learning",
      target: "unsupervised-learning",
      kind: "hierarchy",
      label: "includes",
    },
    {
      id: "ml-rl",
      source: "machine-learning",
      target: "reinforcement-learning",
      kind: "hierarchy",
      label: "includes",
    },
  ],
  answer: {
    title: "How machine learning works",
    introduction:
      "Machine learning uses examples to teach a model how to recognize patterns. After training, the model can apply those patterns to new data, such as classifying an image or estimating a price.",
    sections: [
      {
        title: "From examples to predictions",
        text: "During training, an algorithm adjusts the model to reduce errors or improve another objective. Evaluation on examples it has not seen helps show whether the model generalizes beyond its training data.",
      },
      {
        title: "Three common ways to learn",
        text: "Supervised learning uses labeled examples. Unsupervised learning looks for structure in unlabeled data. Reinforcement learning uses feedback from actions to improve future decisions.",
      },
    ],
    takeaways: [
      "Training finds patterns in examples.",
      "Evaluation checks how well those patterns transfer to new data.",
    ],
    sources: [
      { id: "overview", label: "Introductory overview", status: "placeholder" },
      {
        id: "methods",
        label: "Learning methods reference",
        status: "placeholder",
      },
    ],
  },
};

export const exampleGraphPositions = {
  "artificial-intelligence": { x: 0, y: -112 },
  "machine-learning": { x: 0, y: 0 },
  "neural-networks": { x: -232, y: -36 },
  "deep-learning": { x: -232, y: 104 },
  "supervised-learning": { x: 236, y: -88 },
  "unsupervised-learning": { x: 236, y: 4 },
  "reinforcement-learning": { x: 236, y: 104 },
};

export const exampleEntries = [
  {
    nodeId: "machine-learning",
    name: "Machine Learning",
    query: exampleExploration.query,
  },
  {
    nodeId: "neural-networks",
    name: "Neural Networks",
    query: "What are neural networks?",
  },
  {
    nodeId: "deep-learning",
    name: "Deep Learning",
    query: "How does deep learning work?",
  },
];

export type ExampleEntry = (typeof exampleEntries)[number];

export async function searchExample(query: string): Promise<Exploration> {
  await new Promise<void>((resolve) => setTimeout(resolve, 650));
  return { ...exampleExploration, query };
}
