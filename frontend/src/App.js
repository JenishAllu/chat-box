
import React from "react";
import {BrowserRouter,Routes,Route} from "react-router-dom";
import Auth from "./components/Auth";
import Chat from "./components/Chat";
function App(){
  return(
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Auth/>}/>
        <Route path="/chat" element={<Chat/>}/>
      </Routes>
    </BrowserRouter>
  );
}
export default App;
