import type { StylesheetJson } from "cytoscape";

export const categoryColors = {
  Field: "#6ae2af",
  Method: "#c4b5fd",
  "Learning approach": "#7dd3fc",
  Tool: "#fbbf7a",
  Principle: "#f9a8d4",
  Other: "#cbd5e1",
};

export function graphStyle(fontFamily: string): StylesheetJson {
  return [
    {
      selector: "node",
      style: {
        shape: "round-rectangle",
        width: 126,
        height: 44,
        label: "data(label)",
        "font-family": fontFamily,
        "font-size": 13,
        "font-weight": 600,
        "text-valign": "center",
        "text-halign": "center",
        "text-wrap": "wrap",
        "text-max-width": "112px",
        "background-color": "#17232e",
        "border-width": 1.25,
        "border-color": "#3a4b5b",
        color: "#edf2f7",
      },
    },
    ...Object.entries(categoryColors).map(([category, color]) => ({
      selector: `node[category = "${category}"]`,
      style: { color },
    })),
    {
      selector: "edge",
      style: {
        width: 1.5,
        "curve-style": "bezier",
        "line-color": "#587184",
        "font-family": fontFamily,
        "font-size": 10,
        color: "#b1becb",
        "text-background-color": "#101821",
        "text-background-opacity": 0.92,
        "text-background-padding": "3px",
        "text-background-shape": "roundrectangle",
      },
    },
    { selector: 'edge[kind = "hierarchy"]', style: { "line-style": "dashed" } },
    { selector: "edge.show-label", style: { label: "data(relationship)" } },
    {
      selector: "node.is-root",
      style: { "background-color": "#19362f", "border-color": "#4b9f82" },
    },
    { selector: "node.is-neighbor", style: { "border-color": "#75ad9b" } },
    {
      selector: "edge.is-connected",
      style: { "line-color": "#6ae2af", width: 2 },
    },
    { selector: "node.is-dimmed", style: { opacity: 0.75 } },
    { selector: "edge.is-dimmed", style: { opacity: 0.42 } },
    {
      selector: "node.is-expanded",
      style: { "border-style": "double", "border-width": 3 },
    },
    {
      selector: "node.is-selected",
      style: {
        "border-color": "#6ae2af",
        "border-width": 2,
        "underlay-color": "#6ae2af",
        "underlay-opacity": 0.22,
        "underlay-padding": 4,
        "underlay-shape": "round-rectangle",
      },
    },
    {
      selector: "node.is-loading",
      style: {
        "border-style": "dashed",
        "border-width": 3,
        "border-color": "#7dd3fc",
      },
    },
  ];
}
