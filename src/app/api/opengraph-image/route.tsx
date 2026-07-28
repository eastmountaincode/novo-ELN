import { readFile } from "fs/promises";
import { join } from "path";
import { ImageResponse } from "next/og";

const wulkanFont = readFile(join(process.cwd(), "public/fonts/Wulkan_Text_Light_Italic.otf"));

const size = {
  width: 1200,
  height: 630,
};

export async function GET() {
  const fontData = await wulkanFont;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#020617",
          color: "#f1f5f9",
          fontFamily: "Wulkan Novo",
          fontSize: 300,
          fontStyle: "italic",
          fontWeight: 300,
          lineHeight: 1,
        }}
      >
        Novo
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: "Wulkan Novo",
          data: fontData,
          style: "italic",
          weight: 300,
        },
      ],
    },
  );
}
