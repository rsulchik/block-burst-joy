import { createFileRoute } from "@tanstack/react-router";
import BlockGame from "@/components/BlockGame";

const title = "Block Blast — блочная головоломка 8x8";
const description =
  "Мобильная головоломка: перетаскивай фигуры на поле 8x8, собирай линии, взрывай блоки и бей свой рекорд.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
    ],
  }),
  component: BlockGame,
});
