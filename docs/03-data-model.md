# Mô hình dữ liệu

Tên collection khai báo tập trung tại `packages/shared/src/collections.ts`.
Schema (Zod) nằm trong `packages/shared/src/domain/`.

## Nguyên tắc

1. **Firebase UID là định danh xác thực.** `studentId` chỉ là mã nghiệp vụ, tính
   duy nhất được bảo đảm bằng collection `studentIdIndex` ghi trong cùng
   transaction với việc tạo hồ sơ.
2. **Mọi document có `createdAt`, `updatedAt`, `createdBy`** ghi bằng
   `serverTimestamp()`.
3. **Không xóa cứng dữ liệu học thuật** — chuyển trạng thái `archived`.
4. **Điểm và bài nộp bất biến sau khi công bố**; sửa đổi tạo bản ghi mới và ghi
   audit log.
5. **Tham chiếu bằng ID**, không lồng sâu, để truy vấn và phân quyền đơn giản.

## Cấu trúc

```
users/{uid}                     hồ sơ, globalRole, preferredLanguage, status
studentIdIndex/{studentId}      bảo đảm mã sinh viên duy nhất
academicYears/{id}              2026–2027
semesters/{id}                  Fall 2026
courses/{id}                    E-Commerce 2026, danh sách CLO
classes/{id}                    ECOM-A01, classCode, lecturerIds, policy version
classEnrollments/{id}           (classId, studentUid, status, role trong lớp)
groups/{id}                     G01, maxMembers, memberCount, locked
groupMembers/{id}               (groupId, studentUid, roleIds[R1..R6])
caseStudies/{id}                Case Study Template + metadata
caseVersions/{id}               phiên bản nội dung case
presentationGuides/{id}         khung thuyết trình có version
rubrics/{id}                    rubric có version
policies/{id}                   policy học thuật có version
assignments/{id}                một lần giao case cho nhóm, khóa version policy
submissions/{id}                mỗi version một document, không ghi đè
presentationSessions/{id}       buổi thuyết trình, trạng thái, timer  (Phase 2)
questions/{id}                  câu hỏi trong buổi                    (Phase 2)
questionVotes/{id}              (questionId, voterUid) — một lần      (Phase 2)
questionResponses/{id}          ai trả lời, vai trò nào               (Phase 2)
peerReviews/{id}                (sessionId, reviewerUid) — một phiếu  (Phase 2)
aiAssessments/{id}              kết quả AI, luôn ở trạng thái nháp    (Phase 3)
lecturerAssessments/{id}        điểm rubric do giảng viên nhập        (Phase 3)
grades/{id}                     điểm nhóm, cá nhân, cuối cùng + version policy
cloMappings/{id}                criterion ↔ CLO
notifications/{id}              thông báo cho người dùng
auditLogs/{id}                  không client nào đọc được
systemSettings/{id}             cấu hình nền tảng
```

## Ví dụ document

**users/{uid}**

```json
{
  "uid": "firebase_uid",
  "studentId": "SV001",
  "fullName": "Nguyen Van A",
  "email": "student@university.edu.vn",
  "globalRole": "student",
  "preferredLanguage": "vi",
  "status": "active"
}
```

**classes/{id}**

```json
{
  "classCode": "ECOM-A01",
  "className": "E-Commerce 2026",
  "courseId": "ECOM2026",
  "semesterId": "FALL2026",
  "lecturerIds": ["uid_lecturer"],
  "language": "en",
  "presentationPolicyId": "ecom-2026-standard",
  "presentationPolicyVersion": "2026.1",
  "joinMode": "code",
  "status": "active"
}
```

**assignments/{id}** — khóa version của policy, rubric và case tại thời điểm giao
bài, nên thay đổi về sau không ảnh hưởng bài đã giao.

```json
{
  "classId": "ECOM-A01",
  "groupId": "G01",
  "caseStudyId": "CASE01",
  "caseVersionId": "case_version_01",
  "policyId": "ecom-2026-standard",
  "policyVersion": "2026.1",
  "rubricVersion": "2026.1",
  "presentationDate": "2026-10-01T09:00:00+07:00",
  "submissionDeadline": "2026-09-30T09:00:00+07:00",
  "status": "assigned"
}
```

**grades/{id}**

```json
{
  "assignmentId": "assignment_01",
  "groupId": "G01",
  "studentUid": "student_01",
  "groupScore": 85,
  "individualScore": 90,
  "finalScore": 86,
  "policyId": "ecom-2026-standard",
  "policyVersion": "2026.1",
  "status": "published"
}
```

## Chỉ mục

Composite index khai báo trong `firebase/firestore.indexes.json`, deploy tự động
khi thư mục `firebase/` thay đổi trên `main`.
