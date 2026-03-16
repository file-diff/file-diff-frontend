import { useState } from "react";
import { MONOSPACE_FONTS, DEFAULT_FONT_ID } from "../config/fonts";
import { readFontPreference, writeFontPreference } from "../utils/storage";
import { applyFont } from "../utils/fontInit";
import "./FontSelector.css";

export default function FontSelector() {
  const [currentId, setCurrentId] = useState(
    () => readFontPreference() ?? DEFAULT_FONT_ID
  );

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    writeFontPreference(id);
    setCurrentId(id);
    applyFont(id);
  };

  return (
    <div className="font-selector">
      <label className="font-selector__label" htmlFor="font-select">
        Font
      </label>
      <select
        id="font-select"
        className="font-selector__select"
        value={currentId}
        onChange={handleChange}
      >
        {MONOSPACE_FONTS.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
    </div>
  );
}
