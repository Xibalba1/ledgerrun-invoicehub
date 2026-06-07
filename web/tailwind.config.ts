import houseStyle from "./src/tokens/tailwind.preset";

export default {
  presets: [houseStyle],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
};
