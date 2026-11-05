import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./shared/styles/global.css";
import "./shared/styles/connection.css";
import PictureInPicture from "./features/live-view/components/PictureInPicture";

const pipWindow = new URLSearchParams(window.location.search).get("window") === "pip";
document.documentElement.classList.toggle("pip-window", pipWindow);
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>{pipWindow ? <PictureInPicture /> : <App />}</React.StrictMode>,
);
