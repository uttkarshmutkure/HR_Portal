import { RouterProvider } from "react-router";
import { router } from "./routes";
import { ThemeProvider } from "./components/ThemeProvider";
import { ToastProvider } from "./components/ToastContext"; // 👈 Add this import

export default function App() {
  return (
    <ThemeProvider>
      {/* 👈 Wrap the router inside the ToastProvider */}
      <ToastProvider> 
        <RouterProvider router={router} />
      </ToastProvider>
    </ThemeProvider>
  );
}