#pragma once

#include "vec3.h"
#include <string>
#include <vector>

namespace eficiencia {

/// A 2D loop (outer boundary or inner opening) after projection.
struct Loop2D {
    std::vector<Vec2> vertices;
};

/// A wall extracted from the 3D model, projected to its local 2D plane.
struct Wall {
    /// Human-readable label (e.g. "Wall_003").
    std::string label;

    /// World-space normal of the original face.
    Vec3 normal;

    /// 3D vertices of the outer boundary (before projection).
    std::vector<Vec3> vertices_3d;

    /// Projected 2D outer boundary.
    Loop2D outer;

    /// Projected 2D inner loops (windows, doors — the openings, not the frames).
    std::vector<Loop2D> openings;

    /// Bounding-box dimensions in the projected 2D plane (metres).
    double width  = 0.0;
    double height = 0.0;
};

} // namespace eficiencia
