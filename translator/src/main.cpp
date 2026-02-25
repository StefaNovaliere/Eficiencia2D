#include "wall_extractor.h"
#include "dxf_writer.h"
#include "pdf_writer.h"

#include <cstring>
#include <filesystem>
#include <iostream>
#include <string>
#include <vector>

namespace fs = std::filesystem;

static void print_usage(const char* prog) {
    std::cerr
        << "Usage: " << prog << " [options]\n"
        << "\n"
        << "Options:\n"
        << "  --input  <path>      Input .skp file (required)\n"
        << "  --outdir <path>      Output directory (default: same as input)\n"
        << "  --format <dxf,pdf>   Comma-separated output formats (default: dxf,pdf)\n"
        << "  --scale  <int>       Scale denominator, e.g. 100 for 1:100 (default: 100)\n"
        << "  --paper  <A3|A1>     Paper size for PDF (default: A3)\n"
        << "  --help               Show this help\n";
}

int main(int argc, char* argv[]) {
    std::string input_path;
    std::string outdir;
    std::string formats = "dxf,pdf";
    int scale = 100;
    std::string paper_name = "A3";

    // --- Parse arguments ---
    for (int i = 1; i < argc; ++i) {
        if (std::strcmp(argv[i], "--input") == 0 && i + 1 < argc) {
            input_path = argv[++i];
        } else if (std::strcmp(argv[i], "--outdir") == 0 && i + 1 < argc) {
            outdir = argv[++i];
        } else if (std::strcmp(argv[i], "--format") == 0 && i + 1 < argc) {
            formats = argv[++i];
        } else if (std::strcmp(argv[i], "--scale") == 0 && i + 1 < argc) {
            scale = std::atoi(argv[++i]);
            if (scale <= 0) scale = 100;
        } else if (std::strcmp(argv[i], "--paper") == 0 && i + 1 < argc) {
            paper_name = argv[++i];
        } else if (std::strcmp(argv[i], "--help") == 0) {
            print_usage(argv[0]);
            return 0;
        } else {
            std::cerr << "Unknown option: " << argv[i] << "\n";
            print_usage(argv[0]);
            return 1;
        }
    }

    if (input_path.empty()) {
        std::cerr << "Error: --input is required.\n";
        print_usage(argv[0]);
        return 1;
    }

    if (outdir.empty()) {
        outdir = fs::path(input_path).parent_path().string();
        if (outdir.empty()) outdir = ".";
    }
    fs::create_directories(outdir);

    bool want_dxf = formats.find("dxf") != std::string::npos;
    bool want_pdf = formats.find("pdf") != std::string::npos;

    eficiencia::PaperSize paper = (paper_name == "A1")
        ? eficiencia::paper_a1()
        : eficiencia::paper_a3();

    // --- Extract walls ---
    std::cerr << "[translator] Loading: " << input_path << "\n";
    eficiencia::WallExtractor extractor;
    std::vector<eficiencia::Wall> walls;

    try {
        walls = extractor.extract(input_path);
    } catch (const std::exception& ex) {
        std::cerr << "[translator] ERROR: " << ex.what() << "\n";
        return 2;
    }

    std::cerr << "[translator] Extracted " << walls.size() << " wall(s).\n";

    if (walls.empty()) {
        std::cerr << "[translator] WARNING: No walls found. Check model.\n";
        // Still succeed — the output files will be empty drawings.
    }

    // --- Write outputs ---
    std::string stem = fs::path(input_path).stem().string();

    if (want_dxf) {
        std::string dxf_path = (fs::path(outdir) / (stem + ".dxf")).string();
        std::cerr << "[translator] Writing DXF: " << dxf_path << "\n";
        eficiencia::DxfWriter().write(walls, dxf_path, scale);
        // Print to stdout so the orchestrator can find the file.
        std::cout << "DXF:" << dxf_path << "\n";
    }

    if (want_pdf) {
        std::string pdf_path = (fs::path(outdir) / (stem + ".pdf")).string();
        std::cerr << "[translator] Writing PDF: " << pdf_path << "\n";
        eficiencia::PdfWriter().write(walls, pdf_path, scale, paper);
        std::cout << "PDF:" << pdf_path << "\n";
    }

    std::cerr << "[translator] Done.\n";
    return 0;
}
