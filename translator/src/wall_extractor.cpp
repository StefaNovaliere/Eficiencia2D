#include "wall_extractor.h"

#include <SketchUpAPI/initialize.h>
#include <SketchUpAPI/model/model.h>
#include <SketchUpAPI/model/entities.h>
#include <SketchUpAPI/model/face.h>
#include <SketchUpAPI/model/loop.h>
#include <SketchUpAPI/model/vertex.h>
#include <SketchUpAPI/model/group.h>
#include <SketchUpAPI/model/component_instance.h>
#include <SketchUpAPI/model/component_definition.h>

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace eficiencia {

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

std::vector<Wall> WallExtractor::extract(const std::string& skp_path) {
    SUInitialize();

    SUModelRef model = SU_INVALID;
    SUResult res = SUModelCreateFromFile(&model, skp_path.c_str());
    if (res != SU_ERROR_NONE) {
        SUTerminate();
        throw std::runtime_error("Failed to open .skp file: " + skp_path +
                                 " (SUResult=" + std::to_string(res) + ")");
    }

    SUEntitiesRef entities = SU_INVALID;
    SUModelGetEntities(model, &entities);

    Transform identity;
    collect_faces(entities, identity);

    SUModelRelease(&model);
    SUTerminate();

    return std::move(walls_);
}

// ---------------------------------------------------------------------------
// Recursive entity traversal
// ---------------------------------------------------------------------------

void WallExtractor::collect_faces(SUEntitiesRef entities, const Transform& parent_xf) {
    // --- Faces ---
    size_t face_count = 0;
    SUEntitiesGetNumFaces(entities, &face_count);
    if (face_count > 0) {
        std::vector<SUFaceRef> faces(face_count, SU_INVALID);
        SUEntitiesGetFaces(entities, face_count, faces.data(), &face_count);
        for (size_t i = 0; i < face_count; ++i) {
            process_face(faces[i], parent_xf);
        }
    }

    // --- Groups (recurse with accumulated transform) ---
    size_t group_count = 0;
    SUEntitiesGetNumGroups(entities, &group_count);
    if (group_count > 0) {
        std::vector<SUGroupRef> groups(group_count, SU_INVALID);
        SUEntitiesGetGroups(entities, group_count, groups.data(), &group_count);
        for (size_t i = 0; i < group_count; ++i) {
            SUTransformation su_xf;
            SUGroupGetTransform(groups[i], &su_xf);
            Transform child_xf = parent_xf * Transform(su_xf);

            SUEntitiesRef child_ents = SU_INVALID;
            SUGroupGetEntities(groups[i], &child_ents);
            collect_faces(child_ents, child_xf);
        }
    }

    // --- Component Instances (recurse into their definitions) ---
    size_t inst_count = 0;
    SUEntitiesGetNumInstances(entities, &inst_count);
    if (inst_count > 0) {
        std::vector<SUComponentInstanceRef> instances(inst_count, SU_INVALID);
        SUEntitiesGetInstances(entities, inst_count, instances.data(), &inst_count);
        for (size_t i = 0; i < inst_count; ++i) {
            SUTransformation su_xf;
            SUComponentInstanceGetTransform(instances[i], &su_xf);
            Transform child_xf = parent_xf * Transform(su_xf);

            SUComponentDefinitionRef defn = SU_INVALID;
            SUComponentInstanceGetDefinition(instances[i], &defn);

            SUEntitiesRef child_ents = SU_INVALID;
            SUComponentDefinitionGetEntities(defn, &child_ents);
            collect_faces(child_ents, child_xf);
        }
    }
}

// ---------------------------------------------------------------------------
// Face evaluation
// ---------------------------------------------------------------------------

void WallExtractor::process_face(SUFaceRef face, const Transform& xf) {
    // 1. Get face normal and transform it.
    SUVector3D su_normal;
    SUFaceGetNormal(face, &su_normal);
    Vec3 local_normal{su_normal.x, su_normal.y, su_normal.z};
    Vec3 world_normal = xf.apply_direction(local_normal);

    // 2. Verticality test: normal must be perpendicular to Z.
    if (std::abs(world_normal.z) > kVerticalEpsilon) {
        return; // floor, ceiling, or roof — skip
    }

    // 3. Area test (SketchUp returns area in square inches).
    double area_sq_in = 0.0;
    SUFaceGetArea(face, &area_sq_in);
    double area_m2 = area_sq_in * kInchesToMetres * kInchesToMetres;
    if (area_m2 < kMinAreaM2) {
        return; // too small — trim, baseboard, noise
    }

    // 4. Read outer loop vertices.
    SULoopRef outer_loop = SU_INVALID;
    SUFaceGetOuterLoop(face, &outer_loop);
    std::vector<Vec3> outer_pts = read_loop_vertices(outer_loop, xf);
    if (outer_pts.size() < 3) return;

    // 5. Build local 2D coordinate system for projection.
    Vec3 u_axis, v_axis;
    compute_wall_axes(world_normal, u_axis, v_axis);

    // 6. Project outer loop.
    Wall wall;
    wall.label = "Wall_" + std::to_string(++wall_counter_);
    wall.normal = world_normal;
    wall.vertices_3d = outer_pts;
    wall.outer = project_loop(outer_pts, outer_pts[0], u_axis, v_axis);

    // 7. Read inner loops (openings: windows, doors).
    //    We keep the loop geometry (the hole) but intentionally do NOT recurse
    //    into the component instances that fill them (the frame/glass).
    size_t inner_count = 0;
    SUFaceGetNumInnerLoops(face, &inner_count);
    if (inner_count > 0) {
        std::vector<SULoopRef> inners(inner_count, SU_INVALID);
        SUFaceGetInnerLoops(face, inner_count, inners.data(), &inner_count);
        for (size_t i = 0; i < inner_count; ++i) {
            std::vector<Vec3> inner_pts = read_loop_vertices(inners[i], xf);
            if (inner_pts.size() >= 3) {
                wall.openings.push_back(
                    project_loop(inner_pts, outer_pts[0], u_axis, v_axis));
            }
        }
    }

    // 8. Compute bounding box in projected space.
    double min_x = 1e18, max_x = -1e18, min_y = 1e18, max_y = -1e18;
    for (const auto& p : wall.outer.vertices) {
        min_x = std::min(min_x, p.x);
        max_x = std::max(max_x, p.x);
        min_y = std::min(min_y, p.y);
        max_y = std::max(max_y, p.y);
    }
    wall.width  = max_x - min_x;
    wall.height = max_y - min_y;

    walls_.push_back(std::move(wall));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

std::vector<Vec3> WallExtractor::read_loop_vertices(SULoopRef loop,
                                                     const Transform& xf) const {
    size_t vertex_count = 0;
    SULoopGetNumVertices(loop, &vertex_count);
    std::vector<SUVertexRef> su_verts(vertex_count, SU_INVALID);
    SULoopGetVertices(loop, vertex_count, su_verts.data(), &vertex_count);

    std::vector<Vec3> result;
    result.reserve(vertex_count);
    for (size_t i = 0; i < vertex_count; ++i) {
        SUPoint3D pt;
        SUVertexGetPosition(su_verts[i], &pt);
        // Convert from inches to metres, then apply transform.
        Vec3 local{pt.x * kInchesToMetres,
                   pt.y * kInchesToMetres,
                   pt.z * kInchesToMetres};
        result.push_back(xf.apply(local));
    }
    return result;
}

void WallExtractor::compute_wall_axes(const Vec3& normal,
                                       Vec3& u_axis,
                                       Vec3& v_axis) const {
    // v_axis: project world-Z onto the wall plane.
    Vec3 world_z{0, 0, 1};
    // Subtract the component along the normal to get in-plane "up".
    double d = world_z.dot(normal);
    v_axis = (world_z - normal * d).normalized();

    // u_axis: perpendicular to both normal and v_axis (horizontal on the wall).
    u_axis = v_axis.cross(normal).normalized();
}

Loop2D WallExtractor::project_loop(const std::vector<Vec3>& pts,
                                    const Vec3& origin,
                                    const Vec3& u_axis,
                                    const Vec3& v_axis) const {
    Loop2D loop;
    loop.vertices.reserve(pts.size());
    for (const auto& p : pts) {
        Vec3 rel = p - origin;
        loop.vertices.push_back({rel.dot(u_axis), rel.dot(v_axis)});
    }
    return loop;
}

} // namespace eficiencia
