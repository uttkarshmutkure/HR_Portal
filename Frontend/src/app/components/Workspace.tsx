import { motion, AnimatePresence } from "motion/react";
import { useNavigate } from "react-router";
import {
  ArrowLeft,
  Target,
  Sparkles,
  Send,
  Clock,
  Bookmark,
  Moon,
  Sun,
} from "lucide-react";
import { useState } from "react";
import { useTheme } from "./ThemeProvider";
import AtgeirLogo from "./AtgeirLogo";

export default function Workspace() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [chatInput, setChatInput] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [messages, setMessages] = useState([
    {
      type: "ai",
      text: "Hi! I'm here to help you find the perfect audience segments. What are you looking for today?",
    },
  ]);

  const results = [
    {
      name: "Tech-Forward Millennials",
      match: 94,
      size: "2.3M",
      engagement: "High",
      description: "Urban professionals aged 28-38 with strong interest in emerging technologies",
      providers: ["DataCo", "AudienceHub"],
      hhCount: 450000,
      ppCount: 1850000,
    },
    {
      name: "Sustainable Living Advocates",
      match: 89,
      size: "1.8M",
      engagement: "Very High",
      description: "Environmentally conscious consumers who prioritize eco-friendly products",
      providers: ["GreenData", "EcoMetrics"],
      hhCount: 380000,
      ppCount: 1420000,
    },
    {
      name: "Remote Work Enthusiasts",
      match: 87,
      size: "3.1M",
      engagement: "Medium",
      description: "Digital nomads and remote workers seeking productivity tools and services",
      providers: ["WorkInsights", "DataCo"],
      hhCount: 620000,
      ppCount: 2480000,
    },
    {
      name: "Fitness & Wellness Community",
      match: 82,
      size: "2.7M",
      engagement: "High",
      description: "Health-conscious individuals engaged in fitness, nutrition, and wellness",
      providers: ["HealthData", "WellnessHub"],
      hhCount: 540000,
      ppCount: 2160000,
    },
    {
      name: "Creative Professionals",
      match: 78,
      size: "1.5M",
      engagement: "High",
      description: "Designers, artists, and content creators in creative industries",
      providers: ["CreativeMetrics"],
      hhCount: 300000,
      ppCount: 1200000,
    },
  ];

  const totalHH = results.reduce((sum, r) => sum + r.hhCount, 0);
  const totalPP = results.reduce((sum, r) => sum + r.ppCount, 0);

  const recentSearches = [
    "Tech Enthusiasts",
    "Urban Professionals",
    "Sustainability Advocates",
  ];

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    setMessages([...messages, { type: "user", text: chatInput }]);
    setChatInput("");

    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          type: "ai",
          text: "I've found 47 matching audience segments based on your criteria. Let me show you the top matches.",
        },
      ]);

      setTimeout(() => {
        setShowResults(true);
      }, 500);
    }, 1000);
  };

  const handleResultClick = (resultName: string) => {
    navigate(`/detail/${encodeURIComponent(resultName)}`);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="h-screen flex transition-colors duration-300"
      style={{
        fontFamily: "var(--font-inter)",
        backgroundColor: "var(--bg-main)",
      }}
    >
      {/* Column 1: Sidebar (15%) */}
      <motion.div
        initial={{ x: -100, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="flex flex-col"
        style={{
          width: "15%",
          backgroundColor: "var(--atgeir-navy)",
          color: "white",
        }}
      >
        <div className="p-6 flex-1 flex flex-col">
          <div className="mb-8">
            <AtgeirLogo width={120} className="text-white mb-2" />
            <p className="text-xs opacity-60" style={{ fontFamily: "var(--font-inter)" }}>
              Atgeir Solutions
            </p>
          </div>

          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 mb-8 opacity-80 hover:opacity-100 transition-opacity"
          >
            <ArrowLeft size={20} />
            <span>Back</span>
          </button>

          <h3 className="text-sm uppercase tracking-wider opacity-60 mb-4">
            Recent
          </h3>
          <div className="space-y-2 mb-8">
            {recentSearches.map((search) => (
              <motion.button
                key={search}
                whileHover={{ x: 4 }}
                whileTap={{ scale: 0.97 }}
                className="flex items-center gap-2 w-full text-left py-2 px-3 rounded-lg hover:bg-white/10 transition-colors"
              >
                <Clock size={16} className="opacity-60" />
                <span className="text-sm">{search}</span>
              </motion.button>
            ))}
          </div>

          <h3 className="text-sm uppercase tracking-wider opacity-60 mb-4">
            Saved
          </h3>
          <div className="space-y-2">
            <motion.button
              whileHover={{ x: 4 }}
              whileTap={{ scale: 0.97 }}
              className="flex items-center gap-2 w-full text-left py-2 px-3 rounded-lg hover:bg-white/10 transition-colors"
            >
              <Bookmark size={16} className="opacity-60" />
              <span className="text-sm">My Segments</span>
            </motion.button>
          </div>
        </div>

        {/* Theme Toggle */}
        <div className="p-6 border-t border-white/10">
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.97 }}
            onClick={toggleTheme}
            className="w-full p-3 rounded-lg transition-all bg-white/10 hover:bg-white/20 flex items-center justify-center gap-2"
          >
            {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
            <span className="text-sm">{theme === "light" ? "Dark" : "Light"} Mode</span>
          </motion.button>
        </div>
      </motion.div>

      {/* Column 2: Results Stage (conditional, 50% or 60% when shown) */}
      <AnimatePresence>
        {showResults && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: "60%", opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.6, ease: "easeInOut" }}
            className="flex flex-col overflow-hidden"
            style={{
              backgroundColor: "var(--bg-main)",
            }}
          >
            {/* Header with summary */}
            <div
              className="p-6 border-b"
              style={{ borderColor: "var(--border-tile)" }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2
                    className="text-2xl mb-1"
                    style={{
                      fontFamily: "var(--font-poppins)",
                      fontWeight: 700,
                      color: "var(--text-primary)",
                    }}
                  >
                    Top Matches
                  </h2>
                  <p
                    className="text-sm opacity-60"
                    style={{ color: "var(--text-primary)" }}
                  >
                    Total: {totalHH.toLocaleString()} HH | {totalPP.toLocaleString()} PP
                  </p>
                </div>
              </div>
            </div>

            {/* Results List */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {results.map((result, index) => (
                <motion.div
                  key={result.name}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: index * 0.1 }}
                  whileHover={{
                    scale: 1.01,
                    boxShadow: `0 12px 30px var(--hover-shadow)`,
                  }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => handleResultClick(result.name)}
                  className="transition-all cursor-pointer"
                >
                  {/* Match % Tab */}
                  <div
                    className="px-4 py-2 rounded-t-2xl inline-flex items-center gap-2"
                    style={{
                      backgroundColor:
                        theme === "dark"
                          ? "rgba(242, 101, 34, 0.1)"
                          : "rgba(242, 101, 34, 0.05)",
                    }}
                  >
                    <Target size={16} style={{ color: "var(--atgeir-orange)" }} />
                    <span
                      className="text-sm"
                      style={{
                        color: "var(--atgeir-orange)",
                        fontFamily: "var(--font-inter)",
                        fontWeight: 600,
                      }}
                    >
                      {result.match}% Match
                    </span>
                  </div>

                  {/* Main Card */}
                  <div
                    className="p-6 rounded-2xl rounded-tl-none"
                    style={{
                      backgroundColor: "var(--bg-tile)",
                      border: "1px solid var(--border-tile)",
                      boxShadow: `0 4px 20px var(--shadow-color)`,
                    }}
                  >
                    <h3
                      className="text-xl mb-2"
                      style={{
                        fontFamily: "var(--font-poppins)",
                        fontWeight: 600,
                        color: "var(--text-primary)",
                      }}
                    >
                      {result.name}
                    </h3>
                    <p
                      className="mb-4 opacity-70"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {result.description}
                    </p>
                    <div className="grid grid-cols-2 gap-6 mb-4">
                      <div>
                        <div
                          className="text-xs opacity-60 mb-1"
                          style={{ color: "var(--text-primary)" }}
                        >
                          Audience Size
                        </div>
                        <div
                          className="text-lg"
                          style={{
                            fontFamily: "var(--font-poppins)",
                            fontWeight: 600,
                            color: "var(--text-primary)",
                          }}
                        >
                          {result.size}
                        </div>
                      </div>
                      <div>
                        <div
                          className="text-xs opacity-60 mb-1"
                          style={{ color: "var(--text-primary)" }}
                        >
                          Engagement
                        </div>
                        <div
                          className="text-lg"
                          style={{
                            fontFamily: "var(--font-poppins)",
                            fontWeight: 600,
                            color: "var(--text-primary)",
                          }}
                        >
                          {result.engagement}
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-6 mb-4">
                      <div>
                        <div
                          className="text-xs opacity-60 mb-1"
                          style={{ color: "var(--text-primary)" }}
                        >
                          HH Count
                        </div>
                        <div
                          className="text-sm"
                          style={{
                            fontFamily: "var(--font-inter)",
                            fontWeight: 500,
                            color: "var(--text-primary)",
                          }}
                        >
                          {result.hhCount.toLocaleString()}
                        </div>
                      </div>
                      <div>
                        <div
                          className="text-xs opacity-60 mb-1"
                          style={{ color: "var(--text-primary)" }}
                        >
                          PP Count
                        </div>
                        <div
                          className="text-sm"
                          style={{
                            fontFamily: "var(--font-inter)",
                            fontWeight: 500,
                            color: "var(--text-primary)",
                          }}
                        >
                          {result.ppCount.toLocaleString()}
                        </div>
                      </div>
                    </div>
                    <div>
                      <div
                        className="text-xs opacity-60 mb-2"
                        style={{ color: "var(--text-primary)" }}
                      >
                        Providers
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {result.providers.map((provider) => (
                          <span
                            key={provider}
                            className="px-3 py-1 rounded-full text-xs"
                            style={{
                              backgroundColor:
                                theme === "dark"
                                  ? "rgba(242, 101, 34, 0.1)"
                                  : "rgba(242, 101, 34, 0.05)",
                              color: "var(--atgeir-orange)",
                              border: "1px solid var(--atgeir-orange)",
                            }}
                          >
                            {provider}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Column 3: AI Assistant (35% or 85% when no results) */}
      <motion.div
        initial={{ x: 100, opacity: 0 }}
        animate={{
          x: 0,
          opacity: 1,
          width: showResults ? "25%" : "85%",
        }}
        transition={{ duration: 0.6 }}
        className="flex flex-col"
        style={{
          backgroundColor:
            theme === "dark"
              ? "rgba(242, 101, 34, 0.03)"
              : "rgba(242, 101, 34, 0.02)",
        }}
      >
        {/* Header */}
        <div
          className="p-6 border-b"
          style={{ borderColor: "var(--border-tile)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "var(--atgeir-orange)" }}
            >
              <Sparkles size={20} className="text-white" />
            </div>
            <div>
              <h3
                className="text-lg"
                style={{
                  fontFamily: "var(--font-poppins)",
                  fontWeight: 600,
                  color: "var(--text-primary)",
                }}
              >
                AI Assistant
              </h3>
              <p
                className="text-xs opacity-60"
                style={{ color: "var(--text-primary)" }}
              >
                Share your thoughts - I'm here to help.
              </p>
            </div>
          </div>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((message, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className={`flex ${
                message.type === "user" ? "justify-end" : "justify-start"
              }`}
            >
              <div
                className="max-w-[80%] px-4 py-3 rounded-2xl"
                style={{
                  backgroundColor:
                    message.type === "ai"
                      ? "var(--bg-tile)"
                      : "var(--atgeir-orange)",
                  color:
                    message.type === "ai"
                      ? "var(--text-primary)"
                      : "white",
                  border:
                    message.type === "ai"
                      ? `1px solid var(--border-tile)`
                      : "none",
                  boxShadow:
                    message.type === "ai"
                      ? `0 2px 10px var(--shadow-color)`
                      : "none",
                }}
              >
                {message.type === "ai" && (
                  <Sparkles size={16} className="inline mr-2 opacity-60" />
                )}
                {message.text}
              </div>
            </motion.div>
          ))}
        </div>

        {/* Input Field */}
        <div className="p-6">
          <div
            className="flex items-center gap-3 px-4 py-3 rounded-2xl"
            style={{
              backgroundColor: "var(--bg-tile)",
              border: "1px solid var(--border-tile)",
              boxShadow: `0 2px 10px var(--shadow-color)`,
            }}
          >
            <input
              type="text"
              placeholder="What's on your mind?"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
              className="flex-1 bg-transparent outline-none"
              style={{
                fontFamily: "var(--font-inter)",
                color: "var(--text-primary)",
              }}
            />
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleSendMessage}
              className="w-10 h-10 rounded-full flex items-center justify-center transition-all"
              style={{
                backgroundColor: "var(--atgeir-orange)",
              }}
            >
              <Send size={18} className="text-white" />
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
