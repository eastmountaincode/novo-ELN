import { ImageResponse } from "next/og";
import { getNovoBrand } from "@/lib/novoInstance";

export const runtime = "edge";

const size = {
  width: 1200,
  height: 630,
};

export async function GET() {
  const { wordmark, deploymentLabel } = getNovoBrand();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background: "#020617",
          color: "#f8fafc",
          padding: "76px 84px",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: 12,
            display: "flex",
            background: "#0891b2",
          }}
        />

        <div
          style={{
            width: "100%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div
              style={{
                display: "flex",
                fontSize: 128,
                fontWeight: 500,
                fontStyle: "italic",
                letterSpacing: -6,
                lineHeight: 1,
              }}
            >
              {wordmark}
            </div>
            {deploymentLabel ? (
              <div
                style={{
                  display: "flex",
                  marginTop: 18,
                  color: "#94a3b8",
                  fontSize: 24,
                  letterSpacing: 1,
                }}
              >
                {deploymentLabel}
              </div>
            ) : null}
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ width: 88, height: 5, display: "flex", background: "#0891b2" }} />
            <div
              style={{
                display: "flex",
                marginTop: 28,
                color: "#e2e8f0",
                fontSize: 46,
                fontWeight: 600,
                letterSpacing: -1.5,
              }}
            >
              Electronic lab notebook.
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
