import { motion } from "motion/react";
import { useNavigate, useParams } from "react-router";
import {
  ArrowLeft,
  Target,
  Users,
  TrendingUp,
  MapPin,
  Moon,
  Sun,
  Bookmark,
  Share2,
} from "lucide-react";
import { useTheme } from "./ThemeProvider";
import AtgeirLogo from "./AtgeirLogo";

export default function DetailView() {
  const navigate = useNavigate();
  const { segmentName } = useParams();
  const { theme, toggleTheme } = useTheme();

  // Mock detailed data for the segment
  const segmentData = {
    name: decodeURIComponent(segmentName || ""),
    match: 94,
    description:
      "Urban professionals aged 28-38 with strong interest in emerging technologies, digital innovation, and sustainable tech solutions. This segment is highly engaged with tech brands and shows strong purchasing power.",
    taxonomyPath: "Technology > Consumers > Early Adopters > Urban Professionals",
    demographics: {
      ageRange: "28-38",
      gender: "52% Male, 48% Female",
      income: "$75K - $150K",
      education: "Bachelor's or higher",
    },
    geographic: {
      primary: "Major metro areas",
      regions: ["San Francisco Bay Area", "New York Metro", "Seattle", "Austin", "Boston"],
    },
    metrics: {
      hhCount: 450000,
      ppCount: 1850000,
      engagement: "High",
      avgCPM: "$12.50",
    },
    providers: ["DataCo", "AudienceHub", "TechInsights"],
    interests: [
      "Artificial Intelligence",
      "Sustainable Technology",
      "Smart Home Devices",
      "Electric Vehicles",
      "FinTech",
      "Cloud Computing",
    ],
    behavioral: {
      onlineActivity: "High social media engagement, frequent tech blog readers",
      purchaseBehavior: "Early adopters, premium product preference",
      mediaConsumption: "Podcast listeners, streaming service subscribers",
    },
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="min-h-screen transition-colors duration-300"
      style={{
        backgroundColor: "var(--bg-main)",
        fontFamily: "var(--font-inter)",
      }}
    >
      {/* Header */}
      <div
        className="border-b sticky top-0 z-10 backdrop-blur-md"
        style={{
          backgroundColor:
            theme === "dark"
              ? "rgba(5, 12, 38, 0.9)"
              : "rgba(248, 249, 250, 0.9)",
          borderColor: "var(--border-tile)",
        }}
      >
        <div className="max-w-7xl mx-auto px-8 py-6 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <AtgeirLogo width={120} />
            <button
              onClick={() => navigate("/workspace")}
              className="flex items-center gap-2 opacity-80 hover:opacity-100 transition-opacity"
              style={{ color: "var(--text-primary)" }}
            >
              <ArrowLeft size={20} />
              <span>Back to Results</span>
            </button>
          </div>

          <div className="flex items-center gap-3">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.97 }}
              className="p-3 rounded-xl transition-all"
              style={{
                backgroundColor: "var(--bg-tile)",
                border: "1px solid var(--border-tile)",
                color: "var(--text-primary)",
              }}
            >
              <Bookmark size={20} />
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.97 }}
              className="p-3 rounded-xl transition-all"
              style={{
                backgroundColor: "var(--bg-tile)",
                border: "1px solid var(--border-tile)",
                color: "var(--text-primary)",
              }}
            >
              <Share2 size={20} />
            </motion.button>

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
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-8 py-8">
        {/* Hero Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="mb-8"
        >
          <div className="flex items-center gap-3 mb-4">
            <div
              className="px-4 py-2 rounded-full inline-flex items-center gap-2"
              style={{
                backgroundColor:
                  theme === "dark"
                    ? "rgba(242, 101, 34, 0.1)"
                    : "rgba(242, 101, 34, 0.05)",
              }}
            >
              <Target size={18} style={{ color: "var(--atgeir-orange)" }} />
              <span
                style={{
                  color: "var(--atgeir-orange)",
                  fontFamily: "var(--font-inter)",
                  fontWeight: 600,
                }}
              >
                {segmentData.match}% Match
              </span>
            </div>
          </div>

          <h1
            className="text-4xl mb-4"
            style={{
              fontFamily: "var(--font-poppins)",
              fontWeight: 700,
              color: "var(--text-primary)",
            }}
          >
            {segmentData.name}
          </h1>

          <p
            className="text-lg opacity-70 mb-6"
            style={{ color: "var(--text-primary)" }}
          >
            {segmentData.description}
          </p>

          {/* Taxonomy Path */}
          <div
            className="p-4 rounded-xl inline-block"
            style={{
              backgroundColor: "var(--bg-tile)",
              border: "1px solid var(--border-tile)",
            }}
          >
            <div
              className="text-xs opacity-60 mb-1"
              style={{ color: "var(--text-primary)" }}
            >
              Taxonomy Path
            </div>
            <div
              className="text-sm"
              style={{
                color: "var(--text-primary)",
                fontFamily: "var(--font-inter)",
                fontWeight: 500,
              }}
            >
              {segmentData.taxonomyPath}
            </div>
          </div>
        </motion.div>

        {/* Key Metrics Grid */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="grid grid-cols-4 gap-6 mb-8"
        >
          <div
            className="p-6 rounded-2xl"
            style={{
              backgroundColor: "var(--bg-tile)",
              border: "1px solid var(--border-tile)",
              boxShadow: `0 4px 20px var(--shadow-color)`,
            }}
          >
            <Users
              size={24}
              className="mb-3"
              style={{ color: "var(--atgeir-orange)" }}
            />
            <div
              className="text-2xl mb-1"
              style={{
                fontFamily: "var(--font-poppins)",
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              {segmentData.metrics.hhCount.toLocaleString()}
            </div>
            <div
              className="text-sm opacity-60"
              style={{ color: "var(--text-primary)" }}
            >
              Households
            </div>
          </div>

          <div
            className="p-6 rounded-2xl"
            style={{
              backgroundColor: "var(--bg-tile)",
              border: "1px solid var(--border-tile)",
              boxShadow: `0 4px 20px var(--shadow-color)`,
            }}
          >
            <Users
              size={24}
              className="mb-3"
              style={{ color: "var(--atgeir-orange)" }}
            />
            <div
              className="text-2xl mb-1"
              style={{
                fontFamily: "var(--font-poppins)",
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              {segmentData.metrics.ppCount.toLocaleString()}
            </div>
            <div
              className="text-sm opacity-60"
              style={{ color: "var(--text-primary)" }}
            >
              People
            </div>
          </div>

          <div
            className="p-6 rounded-2xl"
            style={{
              backgroundColor: "var(--bg-tile)",
              border: "1px solid var(--border-tile)",
              boxShadow: `0 4px 20px var(--shadow-color)`,
            }}
          >
            <TrendingUp
              size={24}
              className="mb-3"
              style={{ color: "var(--atgeir-orange)" }}
            />
            <div
              className="text-2xl mb-1"
              style={{
                fontFamily: "var(--font-poppins)",
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              {segmentData.metrics.engagement}
            </div>
            <div
              className="text-sm opacity-60"
              style={{ color: "var(--text-primary)" }}
            >
              Engagement
            </div>
          </div>

          <div
            className="p-6 rounded-2xl"
            style={{
              backgroundColor: "var(--bg-tile)",
              border: "1px solid var(--border-tile)",
              boxShadow: `0 4px 20px var(--shadow-color)`,
            }}
          >
            <Target
              size={24}
              className="mb-3"
              style={{ color: "var(--atgeir-orange)" }}
            />
            <div
              className="text-2xl mb-1"
              style={{
                fontFamily: "var(--font-poppins)",
                fontWeight: 700,
                color: "var(--text-primary)",
              }}
            >
              {segmentData.metrics.avgCPM}
            </div>
            <div
              className="text-sm opacity-60"
              style={{ color: "var(--text-primary)" }}
            >
              Avg CPM
            </div>
          </div>
        </motion.div>

        {/* Detailed Information Grid */}
        <div className="grid grid-cols-2 gap-6">
          {/* Demographics */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="p-6 rounded-2xl"
            style={{
              backgroundColor: "var(--bg-tile)",
              border: "1px solid var(--border-tile)",
              boxShadow: `0 4px 20px var(--shadow-color)`,
            }}
          >
            <h3
              className="text-xl mb-4"
              style={{
                fontFamily: "var(--font-poppins)",
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              Demographics
            </h3>
            <div className="space-y-3">
              <div>
                <div
                  className="text-xs opacity-60 mb-1"
                  style={{ color: "var(--text-primary)" }}
                >
                  Age Range
                </div>
                <div style={{ color: "var(--text-primary)" }}>
                  {segmentData.demographics.ageRange}
                </div>
              </div>
              <div>
                <div
                  className="text-xs opacity-60 mb-1"
                  style={{ color: "var(--text-primary)" }}
                >
                  Gender Distribution
                </div>
                <div style={{ color: "var(--text-primary)" }}>
                  {segmentData.demographics.gender}
                </div>
              </div>
              <div>
                <div
                  className="text-xs opacity-60 mb-1"
                  style={{ color: "var(--text-primary)" }}
                >
                  Income Range
                </div>
                <div style={{ color: "var(--text-primary)" }}>
                  {segmentData.demographics.income}
                </div>
              </div>
              <div>
                <div
                  className="text-xs opacity-60 mb-1"
                  style={{ color: "var(--text-primary)" }}
                >
                  Education
                </div>
                <div style={{ color: "var(--text-primary)" }}>
                  {segmentData.demographics.education}
                </div>
              </div>
            </div>
          </motion.div>

          {/* Geographic */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="p-6 rounded-2xl"
            style={{
              backgroundColor: "var(--bg-tile)",
              border: "1px solid var(--border-tile)",
              boxShadow: `0 4px 20px var(--shadow-color)`,
            }}
          >
            <h3
              className="text-xl mb-4 flex items-center gap-2"
              style={{
                fontFamily: "var(--font-poppins)",
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              <MapPin size={20} style={{ color: "var(--atgeir-orange)" }} />
              Geographic Distribution
            </h3>
            <div className="space-y-3">
              <div>
                <div
                  className="text-xs opacity-60 mb-1"
                  style={{ color: "var(--text-primary)" }}
                >
                  Primary Markets
                </div>
                <div style={{ color: "var(--text-primary)" }}>
                  {segmentData.geographic.primary}
                </div>
              </div>
              <div>
                <div
                  className="text-xs opacity-60 mb-2"
                  style={{ color: "var(--text-primary)" }}
                >
                  Top Regions
                </div>
                <div className="flex flex-wrap gap-2">
                  {segmentData.geographic.regions.map((region) => (
                    <span
                      key={region}
                      className="px-3 py-1 rounded-full text-xs"
                      style={{
                        backgroundColor:
                          theme === "dark"
                            ? "rgba(242, 101, 34, 0.1)"
                            : "rgba(242, 101, 34, 0.05)",
                        color: "var(--text-primary)",
                        border: "1px solid var(--border-tile)",
                      }}
                    >
                      {region}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>

          {/* Interests */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className="p-6 rounded-2xl"
            style={{
              backgroundColor: "var(--bg-tile)",
              border: "1px solid var(--border-tile)",
              boxShadow: `0 4px 20px var(--shadow-color)`,
            }}
          >
            <h3
              className="text-xl mb-4"
              style={{
                fontFamily: "var(--font-poppins)",
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              Interests & Affinities
            </h3>
            <div className="flex flex-wrap gap-2">
              {segmentData.interests.map((interest) => (
                <span
                  key={interest}
                  className="px-3 py-2 rounded-lg text-sm"
                  style={{
                    backgroundColor:
                      theme === "dark"
                        ? "rgba(242, 101, 34, 0.1)"
                        : "rgba(242, 101, 34, 0.05)",
                    color: "var(--atgeir-orange)",
                    border: "1px solid var(--atgeir-orange)",
                  }}
                >
                  {interest}
                </span>
              ))}
            </div>
          </motion.div>

          {/* Behavioral */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className="p-6 rounded-2xl"
            style={{
              backgroundColor: "var(--bg-tile)",
              border: "1px solid var(--border-tile)",
              boxShadow: `0 4px 20px var(--shadow-color)`,
            }}
          >
            <h3
              className="text-xl mb-4"
              style={{
                fontFamily: "var(--font-poppins)",
                fontWeight: 600,
                color: "var(--text-primary)",
              }}
            >
              Behavioral Insights
            </h3>
            <div className="space-y-3">
              <div>
                <div
                  className="text-xs opacity-60 mb-1"
                  style={{ color: "var(--text-primary)" }}
                >
                  Online Activity
                </div>
                <div style={{ color: "var(--text-primary)" }}>
                  {segmentData.behavioral.onlineActivity}
                </div>
              </div>
              <div>
                <div
                  className="text-xs opacity-60 mb-1"
                  style={{ color: "var(--text-primary)" }}
                >
                  Purchase Behavior
                </div>
                <div style={{ color: "var(--text-primary)" }}>
                  {segmentData.behavioral.purchaseBehavior}
                </div>
              </div>
              <div>
                <div
                  className="text-xs opacity-60 mb-1"
                  style={{ color: "var(--text-primary)" }}
                >
                  Media Consumption
                </div>
                <div style={{ color: "var(--text-primary)" }}>
                  {segmentData.behavioral.mediaConsumption}
                </div>
              </div>
            </div>
          </motion.div>
        </div>

        {/* Providers */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.6 }}
          className="mt-6 p-6 rounded-2xl"
          style={{
            backgroundColor: "var(--bg-tile)",
            border: "1px solid var(--border-tile)",
            boxShadow: `0 4px 20px var(--shadow-color)`,
          }}
        >
          <h3
            className="text-xl mb-4"
            style={{
              fontFamily: "var(--font-poppins)",
              fontWeight: 600,
              color: "var(--text-primary)",
            }}
          >
            Data Providers
          </h3>
          <div className="flex flex-wrap gap-3">
            {segmentData.providers.map((provider) => (
              <span
                key={provider}
                className="px-4 py-2 rounded-lg"
                style={{
                  backgroundColor:
                    theme === "dark"
                      ? "rgba(242, 101, 34, 0.1)"
                      : "rgba(242, 101, 34, 0.05)",
                  color: "var(--atgeir-orange)",
                  border: "1px solid var(--atgeir-orange)",
                  fontFamily: "var(--font-inter)",
                  fontWeight: 500,
                }}
              >
                {provider}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}
