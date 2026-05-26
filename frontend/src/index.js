import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import setupAxios from "./setupAxios";

setupAxios();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);