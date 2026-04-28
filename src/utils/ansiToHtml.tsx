const ansiColorNames: Record<number, string> = {
  0: "#000000",
  1: "#800000",
  2: "#008000",
  3: "#808000",
  4: "#000080",
  5: "#800080",
  6: "#008080",
  7: "#c0c0c0",
  8: "#808080",
  9: "#ff0000",
  10: "#00ff00",
  11: "#ffff00",
  12: "#0000ff",
  13: "#ff00ff",
  14: "#00ffff",
  15: "#ffffff",
};

function getAnsi16Color(code: number): string | undefined {
  if (code >= 30 && code <= 37) return ansiColorNames[code - 30];
  if (code >= 90 && code <= 97) return ansiColorNames[8 + (code - 90)];
  return undefined;
}

function getAnsi16BgColor(code: number): string | undefined {
  if (code >= 40 && code <= 47) return ansiColorNames[code - 40];
  if (code >= 100 && code <= 107) return ansiColorNames[8 + (code - 100)];
  return undefined;
}

function getAnsi256Color(code: number): string {
  if (code < 16) return ansiColorNames[code] ?? "#000000";
  if (code < 232) {
    const c = code - 16;
    const r = Math.floor(c / 36);
    const g = Math.floor((c % 36) / 6);
    const b = c % 6;
    const toHex = (v: number) => [0, 95, 135, 175, 215, 255][v];
    return rgbToHex(toHex(r), toHex(g), toHex(b));
  }
  const gray = 8 + (code - 232) * 10;
  return rgbToHex(gray, gray, gray);
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

interface AnsiStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  backgroundColor?: string;
}

const defaultStyle: AnsiStyle = {};

function applySgr(params: number[], current: AnsiStyle): AnsiStyle {
  if (params.length === 0) return {};

  const next: AnsiStyle = { ...current };

  let i = 0;
  while (i < params.length) {
    const code = params[i];
    if (code === 0) {
      return {};
    } else if (code === 1) {
      next.bold = true;
    } else if (code === 3) {
      next.italic = true;
    } else if (code === 4) {
      next.underline = true;
    } else if (code === 9) {
      next.strikethrough = true;
    } else if (code === 22) {
      next.bold = false;
    } else if (code === 23) {
      next.italic = false;
    } else if (code === 24) {
      next.underline = false;
    } else if (code === 29) {
      next.strikethrough = false;
    } else if (code >= 30 && code <= 37) {
      next.color = getAnsi16Color(code);
    } else if (code >= 40 && code <= 47) {
      next.backgroundColor = getAnsi16BgColor(code);
    } else if (code >= 90 && code <= 97) {
      next.color = getAnsi16Color(code);
    } else if (code >= 100 && code <= 107) {
      next.backgroundColor = getAnsi16BgColor(code);
    } else if (code === 38) {
      const sub = params.slice(i + 1);
      if (sub[0] === 5 && sub.length >= 2) {
        next.color = getAnsi256Color(sub[1]);
        i += 2;
      } else if (sub[0] === 2 && sub.length >= 4) {
        next.color = rgbToHex(sub[1], sub[2], sub[3]);
        i += 4;
      }
    } else if (code === 48) {
      const sub = params.slice(i + 1);
      if (sub[0] === 5 && sub.length >= 2) {
        next.backgroundColor = getAnsi256Color(sub[1]);
        i += 2;
      } else if (sub[0] === 2 && sub.length >= 4) {
        next.backgroundColor = rgbToHex(sub[1], sub[2], sub[3]);
        i += 4;
      }
    } else if (code === 39) {
      delete next.color;
    } else if (code === 49) {
      delete next.backgroundColor;
    }
    i++;
  }

  return next;
}

function styleToCss(style: AnsiStyle): Record<string, string> {
  const css: Record<string, string> = {};
  if (style.color) css.color = style.color;
  if (style.backgroundColor) css.backgroundColor = style.backgroundColor;
  if (style.bold) css.fontWeight = "bold";
  if (style.italic) css.fontStyle = "italic";
  if (style.underline) css.textDecoration = "underline";
  if (style.strikethrough) css.textDecoration = "line-through";
  return css;
}

interface AnsiSegment {
  text: string;
  style: AnsiStyle;
}

function parseAnsi(text: string): AnsiSegment[] {
  const ansiRegex = /\x1b\[([\d;]*)m/g;
  const segments: AnsiSegment[] = [];
  let lastIndex = 0;
  let currentStyle: AnsiStyle = {};

  let match: RegExpExecArray | null;
  while ((match = ansiRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, match.index),
        style: currentStyle,
      });
    }

    const paramStr = match[1];
    const params = paramStr
      ? paramStr.split(";").map((p) => Number.parseInt(p, 10))
      : [];

    // Consume parameters for extended color sequences
    let consumed = 0;
    for (let j = 0; j < params.length; j++) {
      if ((params[j] === 38 || params[j] === 48) && j + 1 < params.length) {
        if (params[j + 1] === 5 && j + 2 < params.length) {
          consumed += 3;
          j += 2;
        } else if (params[j + 1] === 2 && j + 4 < params.length) {
          consumed += 5;
          j += 4;
        }
      }
    }

    currentStyle = applySgr(params, currentStyle);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      style: currentStyle,
    });
  }

  return segments;
}

export function ansiToReactNodes(text: string): React.ReactNode[] {
  const segments = parseAnsi(text);
  const nodes: React.ReactNode[] = [];

  for (let i = 0; i < segments.length; i++) {
    const { text: segText, style } = segments[i];
    if (!segText) continue;

    const isPlain = Object.keys(style).length === 0;
    if (isPlain) {
      nodes.push(<span key={i}>{segText}</span>);
    } else {
      const css = styleToCss(style);
      nodes.push(
        <span key={i} style={css}>
          {segText}
        </span>
      );
    }
  }

  return nodes;
}
