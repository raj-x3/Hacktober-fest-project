# HACKATHON.md

## Project Name

PaperTrail – AI Research-to-Code Traceability

## Problem Statement

Machine learning research papers often publish their source code on GitHub, but connecting the experimental claims made in a paper to their actual implementation can be difficult and time-consuming.

Students, researchers, and developers may struggle to identify where specific methodologies, dataset configurations, training procedures, and evaluation metrics are implemented in a repository.

PaperTrail aims to solve this problem by analysing a research paper alongside its associated GitHub repository. It identifies important experimental claims, searches for relevant implementation evidence, and highlights missing or unclear information.

The goal is to make machine learning research easier to inspect, understand, and investigate by providing an evidence-based connection between published research and source code.

## Models Used

### Gemma 4 (E4B) – Primary AI Model

- **Runtime:** Ollama
- **Execution:** Locally on the development machine
- **Purpose:** Understanding research claims, interpreting code and configuration files, identifying relationships between claims and implementation evidence, and generating explanations.
- **Why Gemma 4:** PaperTrail requires semantic understanding of both natural-language research papers and programming code. Gemma helps interpret these different sources and connect related information beyond simple keyword matching.

### Gemma 4 (E2B) – Alternative Model

- **Purpose:** Lower-resource alternative for machines that cannot comfortably run the E4B model.
- **Why:** Provides a smaller local model option while maintaining the project's Gemma-based architecture.



## Team Name

The Glitch

## Team Members

- Member 1 – Dipanshu Raj

