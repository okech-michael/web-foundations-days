PRAGMA foreign_keys = ON;

CREATE TABLE students (
    student_id INTEGER PRIMARY KEY,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE
);

CREATE TABLE courses (
    course_id INTEGER PRIMARY KEY,
    course_name TEXT NOT NULL UNIQUE,
    instructor TEXT NOT NULL
);

CREATE TABLE enrolments (
    student_id INTEGER NOT NULL,
    course_id INTEGER NOT NULL,
    grade TEXT,
    PRIMARY KEY (student_id, course_id),
    FOREIGN KEY (student_id) REFERENCES students (student_id) ON DELETE CASCADE,
    FOREIGN KEY (course_id) REFERENCES courses (course_id) ON DELETE CASCADE
);

CREATE INDEX idx_enrolments_course_student
ON enrolments (course_id, student_id);

INSERT INTO students (student_id, full_name, email) VALUES
    (1, 'Amina Yusuf', 'amina.yusuf@example.com'),
    (2, 'Daniel Okafor', 'daniel.okafor@example.com'),
    (3, 'Lina Chen', 'lina.chen@example.com'),
    (4, 'Mateo Rivera', 'mateo.rivera@example.com');

INSERT INTO courses (course_id, course_name, instructor) VALUES
    (1, 'Introduction to Biology', 'Dr. Patel'),
    (2, 'World History', 'Prof. Morgan'),
    (3, 'Algebra II', 'Ms. Kim');

INSERT INTO enrolments (student_id, course_id, grade) VALUES
    (1, 1, 'A'),
    (1, 2, 'B+'),
    (2, 1, 'B'),
    (2, 3, 'A-'),
    (3, 2, 'A');

-- All courses for one student, selected by name.
SELECT c.course_name, e.grade
FROM students AS s
JOIN enrolments AS e ON e.student_id = s.student_id
JOIN courses AS c ON c.course_id = e.course_id
WHERE s.full_name = 'Amina Yusuf'
ORDER BY c.course_name;

-- All students enrolled in one course.
SELECT s.full_name, s.email, e.grade
FROM courses AS c
JOIN enrolments AS e ON e.course_id = c.course_id
JOIN students AS s ON s.student_id = e.student_id
WHERE c.course_name = 'World History'
ORDER BY s.full_name;

-- Number of enrolled students per course, including courses with no students.
SELECT c.course_name, COUNT(e.student_id) AS student_count
FROM courses AS c
LEFT JOIN enrolments AS e ON e.course_id = c.course_id
GROUP BY c.course_id, c.course_name
ORDER BY c.course_name;

-- Students who are not enrolled in any course.
SELECT s.student_id, s.full_name, s.email
FROM students AS s
LEFT JOIN enrolments AS e ON e.student_id = s.student_id
WHERE e.student_id IS NULL
ORDER BY s.full_name;

-- Update the grade for Amina Yusuf's Biology enrolment.
UPDATE enrolments
SET grade = 'A+'
WHERE student_id = (
    SELECT student_id FROM students WHERE full_name = 'Amina Yusuf'
)
AND course_id = (
    SELECT course_id FROM courses WHERE course_name = 'Introduction to Biology'
);
