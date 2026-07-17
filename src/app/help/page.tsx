"use client";

import React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LuArrowLeft, LuHeart, LuCoffee, LuMail } from "react-icons/lu";
import { FaGithub, FaYoutube, FaDiscord } from "react-icons/fa";
import { FaXTwitter } from "react-icons/fa6";
import ThemeToggle from "@/components/ui/ThemeToggle";
import styles from "./page.module.css";

export default function HelpPage() {
  const router = useRouter();

  return (
    <div className={styles.pageWrapper}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <button
              onClick={() => router.push("/")}
              className={styles.backBtn}
              aria-label="Go back"
              title="Return to the live intelligence map"
            >
              <LuArrowLeft size={24} />
            </button>
          </div>

          <div className={styles.headerCenter}>
            <svg
              className={styles.logoImg}
              width="200"
              height="200"
              viewBox="0 0 200 200"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ height: "2.5rem", width: "auto" }}
            >
              <path
                className={styles.logoFill}
                d="M100 110.528L125 83.5281H75L100 110.528Z"
              />
              <path
                className={styles.logoStroke}
                d="M99.2662 19.3206C99.662 18.8931 100.338 18.8931 100.734 19.3206L149.734 72.2406C149.905 72.4254 150 72.6681 150 72.92V126.136C150 126.388 149.905 126.631 149.734 126.816L100.734 179.736C100.338 180.163 99.662 180.163 99.2662 179.736L50.2662 126.816C50.0951 126.631 50 126.388 50 126.136V72.92C50 72.6681 50.0951 72.4254 50.2662 72.2406L99.2662 19.3206Z"
                strokeWidth="12"
              />
              <path
                className={styles.logoStroke}
                d="M100 110.528L125 83.5281H75L100 110.528Z"
                strokeWidth="12"
              />
            </svg>
            <h1 className={styles.logoTitle}>Seraphim - Help</h1>
          </div>

          <div className={styles.headerRight}>
            <ThemeToggle />
          </div>
        </header>

        <div className={styles.welcomeHero}>
          <h2 className={styles.title}>Welcome to Seraphim</h2>
          <p className={styles.subtitle}>
            Your real-time OSINT (Open-Source Intelligence) news aggregator. We
            scrape global headlines, extract geographic locations, figure out
            trends, and plot them on an interactive dashboard.
          </p>
        </div>

        <main>
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              <LuHeart
                size={24}
                style={{ fill: "rgba(239, 68, 68, 0.15)", color: "#ef4444" }}
              />
              Support Seraphim
            </h2>
            <p className={styles.text}>
              Seraphim is actively developed and maintained. If you find value
              in our platform, consider supporting the development!
            </p>
            <a
              href="https://ko-fi.com/dnasha"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.kofiButton}
              title="Support Seraphim development on Ko-fi"
            >
              <LuCoffee size={20} />
              Support on Ko-fi
            </a>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              <FaGithub size={24} />
              Open Source
            </h2>
            <p className={styles.text}>
              Seraphim is open source! We are always happy to welcome
              contributors to the project. You can check out our codebase,
              submit issues, or create pull requests on GitHub.
            </p>
            <a
              href="https://github.com/dnasha/Seraphim"
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
              title="Open the Seraphim source repository on GitHub"
            >
              github.com/dnasha/Seraphim
            </a>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>
              <LuMail size={24} />
              Contact Us
            </h2>
            <p className={styles.text}>
              Need help or have feedback? Reach out to us via email:
            </p>
            <ul
              style={{ listStyleType: "none", padding: 0, marginTop: "16px" }}
            >
              <li style={{ marginBottom: "8px" }}>
                <strong style={{ color: "var(--text-primary)" }}>
                  Support:
                </strong>{" "}
                <a href="mailto:support@seraphi.me" className={styles.link} title="Email Seraphim support">
                  support@seraphi.me
                </a>
              </li>
              <li style={{ marginBottom: "8px" }}>
                <strong style={{ color: "var(--text-primary)" }}>
                  Feedback:
                </strong>{" "}
                <a href="mailto:feedback@seraphi.me" className={styles.link} title="Email product feedback to Seraphim">
                  feedback@seraphi.me
                </a>
              </li>
              <li>
                <strong style={{ color: "var(--text-primary)" }}>Legal:</strong>{" "}
                <a href="mailto:legal@seraphi.me" className={styles.link} title="Email the Seraphim legal contact">
                  legal@seraphi.me
                </a>
              </li>
            </ul>
          </section>

          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Community & Socials</h2>
            <p className={styles.text}>
              Join our community or follow us for the latest updates:
            </p>
            <div className={styles.socialGrid}>
              <a
                href="https://x.com/seraphimosint"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.socialBtn}
                title="Follow us on X"
              >
                <FaXTwitter size={20} />
              </a>
              <a
                href="https://www.youtube.com/@seraphimosint"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.socialBtn}
                title="Subscribe on YouTube"
              >
                <FaYoutube size={20} />
              </a>
              <a
                href="https://discord.gg/rqaBsXkFmY"
                target="_blank"
                rel="noopener noreferrer"
                className={styles.socialBtn}
                title="Join our Discord"
              >
                <FaDiscord size={20} />
              </a>
            </div>
          </section>
        </main>

        <footer className={styles.footer}>
          <div className={styles.footerLinks}>
            <Link href="/terms?from=help" className={styles.link} title="Read the Terms of Service">
              Terms of Service
            </Link>
            <Link href="/privacy?from=help" className={styles.link} title="Read the Privacy Policy">
              Privacy Policy
            </Link>
          </div>
          <p>
            &copy; {new Date().getFullYear()} Seraphim. All rights reserved.
          </p>
        </footer>
      </div>
    </div>
  );
}
