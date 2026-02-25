#pragma once

#include "wall.h"
#include "transform.h"

#include <SketchUpAPI/common.h>
#include <SketchUpAPI/model/model.h>
#include <SketchUpAPI/model/entities.h>
#include <SketchUpAPI/model/face.h>
#include <SketchUpAPI/model/loop.h>
#include <SketchUpAPI/model/vertex.h>
#include <SketchUpAPI/model/group.h>
#include <SketchUpAPI/model/component_instance.h>
#include <SketchUpAPI/model/component_definition.h>

#include <string>
#include <vector>

namespace eficiencia {

class WallExtractor {
public:
    /// Minimum face area in square metres to qualify as a wall.
    static constexpr double kMinAreaM2 = 1.5;

    /// Maximum |normal.z| to consider a face "vertical".
    static constexpr double kVerticalEpsilon = 0.08;

    /// SketchUp stores geometry in inches; 1 inch = 0.0254 m.
    static constexpr double kInchesToMetres = 0.0254;

    /// Load a .skp file and extract walls.
    /// Returns non-empty vector on success.  Throws std::runtime_error on failure.
    std::vector<Wall> extract(const std::string& skp_path);

private:
    /// Recursively collect vertical faces from an entities container.
    void collect_faces(SUEntitiesRef entities, const Transform& parent_xf);

    /// Evaluate a single face: check normal, area, project, store.
    void process_face(SUFaceRef face, const Transform& xf);

    /// Project a 3D loop onto a wall's local 2D coordinate system.
    Loop2D project_loop(const std::vector<Vec3>& pts,
                        const Vec3& origin,
                        const Vec3& u_axis,
                        const Vec3& v_axis) const;

    /// Compute the local 2D axes for a wall given its normal.
    /// u_axis = horizontal along wall, v_axis = vertical (world Z projected).
    void compute_wall_axes(const Vec3& normal, Vec3& u_axis, Vec3& v_axis) const;

    /// Read vertices from a loop.
    std::vector<Vec3> read_loop_vertices(SULoopRef loop, const Transform& xf) const;

    int wall_counter_ = 0;
    std::vector<Wall> walls_;
};

} // namespace eficiencia
