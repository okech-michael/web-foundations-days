# Library Books API

Base URL: `/api`

## Endpoints

- **List books**
  - Method and path: `GET /api/books`
  - Description: Returns the collection of books.
  - Success status: `200 OK`

- **Get one book**
  - Method and path: `GET /api/books/{bookId}`
  - Description: Returns the book with the specified ID.
  - Success status: `200 OK`

- **Create a book**
  - Method and path: `POST /api/books`
  - Description: Creates a book and returns the saved resource.
  - Example request body:
    ```json
    {
      "title": "The Left Hand of Darkness",
      "author": "Ursula K. Le Guin",
      "publishedYear": 1969
    }
    ```
  - Success status: `201 Created`

- **Update a book**
  - Method and path: `PUT /api/books/{bookId}`
  - Description: Replaces the editable details of the specified book.
  - Example request body:
    ```json
    {
      "title": "The Left Hand of Darkness",
      "author": "Ursula K. Le Guin",
      "publishedYear": 1969
    }
    ```
  - Success status: `200 OK`

- **Delete a book**
  - Method and path: `DELETE /api/books/{bookId}`
  - Description: Deletes the specified book.
  - Success status: `204 No Content`

- **List books by author**
  - Method and path: `GET /api/books?author=Ursula%20K.%20Le%20Guin`
  - Description: Returns books whose author matches the `author` query parameter.
  - Success status: `200 OK`

## Errors

- **400 Bad Request** — The request is invalid, for example a create request omits the required `title` field or supplies a non-numeric `publishedYear`.
- **404 Not Found** — The requested book ID does not exist, for example `GET /api/books/9999`.
