# School Database Design

## Tables and relationships

- **Students** stores each student's ID, full name, and unique email address. A student can enrol in many courses.
- **Courses** stores each course's ID, unique name, and instructor. A course can have many students.
- **Enrolments** records a student's participation in a course and their grade. Its composite primary key (`student_id`, `course_id`) prevents the same student from enrolling in the same course twice, while its foreign keys link each enrolment to an existing student and course.

The relationship from students to enrolments is one-to-many: one student can have multiple enrolment rows, while each enrolment belongs to one student. The relationship from courses to enrolments is also one-to-many: one course can have multiple enrolment rows, while each enrolment belongs to one course. Together, students and courses have a many-to-many relationship. The enrolments join table is needed to represent that relationship and to store facts about each pairing, such as the student's grade.

## Index

I would add an index on `enrolments(course_id, student_id)`. The composite primary key already supports lookups beginning with `student_id`, but queries that list students in a course filter by `course_id`; this index makes that lookup faster.

## SQL or NoSQL?

I would choose a relational SQL database for this school system. Students, courses, and enrolments have clear relationships and constraints: student emails must be unique, enrolments must reference existing records, and duplicate enrolments must be prevented. SQL foreign keys and transactions help preserve that integrity, while joins make reports such as course rosters and enrolment counts straightforward. The grade is naturally attached to a specific student-course relationship, which fits the enrolments table well.
