import { motion } from "motion/react";
import { useNavigate } from "react-router";
import { ChevronRight, Layers, Building2, TrendingUp, Moon, Sun } from "lucide-react";
import { useState } from "react";
import { useTheme } from "./ThemeProvider";
import AtgeirLogo from "./AtgeirLogo";

export default function Landing() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const discoveryTags = [
    "Luxury Shoppers",
    "Adventure Seekers",
    "SaaS Buyers",
    "Foodies",
    "Fitness Freaks",
  ];

  const metrics = [
    {
      icon: Layers,
      value: "1K+",
      label: "Active Segments",
    },
    {
      icon: Building2,
      value: "8",
      label: "Organizations",
    },
    {
      icon: TrendingUp,
      value: "98.7%",
      label: "Match Accuracy",
    },
  ];

  const handleSearch = () => {
    navigate("/workspace");
  };

  const handleTagClick = (tag: string) => {
    setActiveTag(tag);
    setSearchQuery(tag);
    setTimeout(() => {
      navigate("/workspace");
    }, 300);
  };

  return (
    <div
      className="min-h-screen flex flex-col transition-colors duration-300"
      style={{
        backgroundColor: "var(--bg-main)",
        fontFamily: "var(--font-inter)",
      }}
    >
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="px-12 py-8 flex items-center justify-between"
      >
        <AtgeirLogo />

        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.97 }}
          onClick={toggleTheme}
          className="p-3 rounded-xl transition-all"
          style={{
            backgroundColor: "var(--bg-tile)",
            border: "1px solid var(--border-tile)",
            color: "var(--text-primary)",
          }}
        >
          {theme === "light" ? <Moon size={20} /> : <Sun size={20} />}
        </motion.button>
      </motion.header>

      {/* Main Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 -mt-16">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="w-full max-w-3xl"
        >
          {/* Main Headline */}
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="text-6xl mb-4 text-center leading-tight"
            style={{
              fontFamily: "var(--font-poppins)",
              fontWeight: 800,
              color: "var(--text-primary)",
            }}
          >
            The Search Utility
          </motion.h2>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="text-center mb-12 opacity-60"
            style={{
              fontFamily: "var(--font-inter)",
              color: "var(--text-primary)",
            }}
          >
            Find your perfect audience with precision and intelligence
          </motion.p>

          {/* Central Search Bar */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="relative mb-8"
          >
            <div
              className="flex items-center gap-4 px-8 py-6 rounded-full transition-all"
              style={{
                backgroundColor: "var(--bg-tile)",
                border: "1px solid var(--border-tile)",
                boxShadow: `0 4px 20px var(--shadow-color)`,
              }}
            >
              <input
                type="text"
                placeholder="Describe your ideal audience..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                className="flex-1 bg-transparent outline-none"
                style={{
                  fontFamily: "var(--font-inter)",
                  color: "var(--text-primary)",
                  fontSize: "1.125rem",
                }}
              />
              <motion.button
                whileHover={{ scale: 1.05, boxShadow: "0 0 15px rgba(242, 101, 34, 0.4)" }}
                whileTap={{ scale: 0.97 }}
                onClick={handleSearch}
                className="w-12 h-12 rounded-full flex items-center justify-center transition-all"
                style={{
                  backgroundColor: "var(--atgeir-orange)",
                }}
              >
                <ChevronRight className="text-white" size={24} />
              </motion.button>
            </div>
          </motion.div>

          {/* Discovery Tags */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
            className="flex flex-wrap gap-3 justify-center mb-16"
          >
            {discoveryTags.map((tag, index) => (
              <motion.button
                key={tag}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4, delay: 0.7 + index * 0.1 }}
                whileHover={{
                  scale: 1.05,
                  borderColor: "var(--atgeir-orange)",
                  backgroundColor: theme === "dark"
                    ? "rgba(242, 101, 34, 0.1)"
                    : "rgba(242, 101, 34, 0.05)",
                }}
                whileTap={{ scale: 0.97 }}
                onClick={() => handleTagClick(tag)}
                className="px-6 py-3 rounded-full transition-all backdrop-blur-sm"
                style={{
                  backgroundColor: activeTag === tag
                    ? (theme === "dark" ? "rgba(242, 101, 34, 0.1)" : "rgba(242, 101, 34, 0.05)")
                    : "var(--bg-tile)",
                  border: `1px solid ${activeTag === tag ? "var(--atgeir-orange)" : "var(--border-tile)"}`,
                  fontFamily: "var(--font-inter)",
                  color: "var(--text-primary)",
                }}
              >
                {tag}
              </motion.button>
            ))}
          </motion.div>
        </motion.div>
      </div>

      {/* Metric Grid */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.8 }}
        className="px-8 pb-12"
      >
        <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          {metrics.map((metric, index) => (
            <motion.div
              key={metric.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.9 + index * 0.1 }}
              whileHover={{
                scale: 1.02,
                boxShadow: `0 12px 30px var(--hover-shadow)`,
                borderColor: "var(--atgeir-orange)"
              }}
              className="p-8 rounded-3xl transition-all cursor-pointer"
              style={{
                backgroundColor: "var(--bg-tile)",
                border: "1px solid var(--border-tile)",
                boxShadow: `0 4px 20px var(--shadow-color)`,
              }}
            >
              <div className="flex items-start gap-4">
                <div
                  className="p-3 rounded-xl"
                  style={{
                    backgroundColor: theme === "dark"
                      ? "rgba(242, 101, 34, 0.1)"
                      : "rgba(242, 101, 34, 0.05)",
                  }}
                >
                  <metric.icon
                    size={24}
                    style={{ color: "var(--atgeir-orange)" }}
                    strokeWidth={1.5}
                  />
                </div>
                <div>
                  <div
                    className="text-3xl mb-1"
                    style={{
                      fontFamily: "var(--font-poppins)",
                      fontWeight: 700,
                      color: "var(--text-primary)",
                    }}
                  >
                    {metric.value}
                  </div>
                  <div
                    className="opacity-60"
                    style={{
                      fontFamily: "var(--font-inter)",
                      color: "var(--text-primary)",
                    }}
                  >
                    {metric.label}
                  </div>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
