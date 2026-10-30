import { lowlight } from "lowlight/lib/core.js";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

// CMS code blocks do not expose a language picker. Register the common web and
// configuration languages rather than importing lowlight's 35-language bundle.
lowlight.registerLanguage("bash", bash);
lowlight.registerLanguage("css", css);
lowlight.registerLanguage("javascript", javascript);
lowlight.registerLanguage("json", json);
lowlight.registerLanguage("markdown", markdown);
lowlight.registerLanguage("python", python);
lowlight.registerLanguage("sql", sql);
lowlight.registerLanguage("typescript", typescript);
lowlight.registerLanguage("xml", xml);
lowlight.registerLanguage("yaml", yaml);

export { lowlight };
